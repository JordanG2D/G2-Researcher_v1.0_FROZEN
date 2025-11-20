import os
import sys
import json
import subprocess
import threading
from concurrent.futures import ThreadPoolExecutor
from typing import List, Optional, Dict, Any

from google import genai
from google.genai import types

from logger import print_panel, print_status, log_step, logger


# Global orchestrator state
_default_gpu: Optional[str] = None
_experiment_counter: int = 0


def emit_event(event_type: str, data: Dict[str, Any]) -> None:
    """Emit a structured event for the frontend."""
    # Only emit structured events when explicitly enabled (e.g. via the web API).
    # This keeps pure CLI runs clean.
    if not os.environ.get("AI_RESEARCHER_ENABLE_EVENTS"):
        return

    payload = {
        "type": event_type,
        "timestamp": 0,  # Frontend will timestamp
        "data": data,
    }
    # Use a special prefix that the frontend parser will look for
    print(f"::EVENT::{json.dumps(payload)}")
    sys.stdout.flush()


def _build_orchestrator_generation_config(
    *,
    tools: Optional[List] = None,
    system_instruction: Optional[str] = None,
    disable_autofc: bool = False,
) -> types.GenerateContentConfig:
    """
    Build a GenerateContentConfig for the orchestrator agent.

    - Enables Gemini "thinking mode" with visible thought summaries.
    - Sets thinking_level=HIGH.
    - Optionally disables automatic function calling so we can manually run tools
      and show thoughts before actions.
    """
    thinking_config = types.ThinkingConfig(
        thinking_level=types.ThinkingLevel.HIGH,
        include_thoughts=True,
    )

    config_kwargs: Dict[str, Any] = {
        "tools": tools,
        "system_instruction": system_instruction,
        "thinking_config": thinking_config,
    }

    if disable_autofc:
        config_kwargs["automatic_function_calling"] = types.AutomaticFunctionCallingConfig(
            disable=True
        )

    return types.GenerateContentConfig(**config_kwargs)


def _build_orchestrator_system_prompt(
    num_initial_agents: int,
    max_rounds: int,
    default_gpu_hint: Optional[str],
    max_parallel_experiments: int,
) -> str:
    """
    System-level instructions for the orchestrator (principal investigator).
    """
    compute_hint = default_gpu_hint or "CPU-only (no explicit GPU request)"
    return f"""You are a principal investigator orchestrating a team of autonomous research scientists.
Your goal is to answer a high-level research question as rigorously as possible.

You have access to this tool:

- run_researcher(hypothesis: str, gpu: Optional[str] = None):
  Launches an independent single-researcher agent (in its own process) that will:
    - interpret the hypothesis
    - plan experiments
    - run Python code in a Modal sandbox
    - iteratively refine its experiments
    - produce a final report explaining how it tested the hypothesis and what it found

  The tool returns a JSON object with:
    - experiment_id: integer identifier
    - hypothesis: the original hypothesis string
    - gpu: the GPU string that was requested (or null/None for CPU-only)
    - exit_code: integer process exit code
    - transcript: the full textual transcript of the agent's run, including:
        - its visible "thinking" summaries
        - tool calls and logs
        - the final report it prints at the end

GPU / compute selection:

- The `gpu` argument is optional.
- If you provide it, it should usually be one of: "T4", "A10G", "A100", or "any".
- If you omit it, the host uses its default compute setting for experiments:
  {compute_hint}

Use stronger GPUs (e.g., "A100") only when you are conceptually simulating
experiments that would truly require more compute (e.g., large models, longer runs).
Use "T4" or "any" for lighter experiments, or omit the argument to stick to the default.

Parallelism:

- The host can run up to {max_parallel_experiments} experiments in parallel in a single wave.
- If you propose multiple run_researcher calls in one step, they will be launched concurrently.

Workflow:

1. **Decomposition**
   Break the research task into concrete, testable hypotheses.
   Start with about {num_initial_agents} distinct hypotheses that, together,
   would substantially answer the research task.

2. **Delegation**
   For each hypothesis that needs empirical validation, call `run_researcher`.
   Use the tool sparingly and purposefully—each call is expensive.

3. **Synthesis & Follow-ups**
   Carefully read the transcripts that come back.
   Extract:
   - what was tested and how
   - key numerical or qualitative results
   - limitations, confounders, and failure cases

   Decide whether additional experiments are needed:
   - follow-ups to clarify ambiguous results
   - ablations or robustness checks
   - sanity checks when results look surprising

   Avoid more than {max_rounds} waves of experiments unless strictly necessary.
   Prefer a small number of high-quality, well-motivated experiments
   over many redundant or noisy runs.

4. **Final Paper**
   When you are satisfied that the evidence is sufficient, synthesize everything
   into an Arxiv-style paper with the following structure:

   - Title
   - Authors (use "AI Researcher" as a placeholder author list)
   - Abstract
   - 1. Introduction
   - 2. Method
   - 3. Experiments
   - 4. Results
   - 5. Discussion & Limitations
   - 6. Related Work (high level; no formal citations or references required)
   - 7. Conclusion

   Make the paper:
   - technically precise and information-dense
   - explicit about experimental design and assumptions
   - honest about limitations and potential failure modes

Important:

- **Think step-by-step and narrate your reasoning.**
  Your thought summaries will be shown in the CLI under "Orchestrator Thinking".
- **Be explicit about decisions.**
  Explain why you are launching new agents or why you believe experiments are sufficient.
- **Use the tool when it matters.**
  Do not call the tool for trivial reformulations or questions that can be answered
  by pure reasoning.

Termination:

- When your final Arxiv-style paper is complete, end your response with a line
  that contains only:
  [DONE]
"""


def run_researcher(hypothesis: str, gpu: Optional[str] = None, test_mode: bool = False) -> Dict[str, Any]:
    """
    Tool wrapper that launches a single-researcher agent experiment in a separate process.

    This function:
    - Spawns: `python main.py "<hypothesis>" --mode single [--gpu GPU]`
    - Streams all logs from the underlying agent back to the user's terminal
      in real time (so all thinking/tool calls are visible).
    - Captures the full transcript (stdout + stderr) so the orchestrator
      can feed it back into Gemini.

    Args:
        hypothesis: The experimental hypothesis to pass to the single agent.
        gpu: Optional GPU string ("T4", "A10G", "A100", "any", etc.).
             If None, uses the orchestrator's default GPU (which may be CPU-only).
        test_mode: If True, runs the agent in test mode (mock data).

    Returns:
        A JSON-serializable dict:
            {
                "experiment_id": int,
                "hypothesis": str,
                "gpu": Optional[str],
                "exit_code": int,
                "transcript": str,
            }
    """
    global _experiment_counter, _default_gpu

    _experiment_counter += 1
    experiment_id = _experiment_counter

    assigned_gpu = gpu or _default_gpu

    header_lines = [
        f"Experiment {experiment_id}",
        f"GPU: {assigned_gpu or 'CPU-only / default'}",
        "Hypothesis:",
        hypothesis,
    ]
    print_panel(
        "\n".join(header_lines),
        f"Experiment {experiment_id}: Scheduled",
        "bold blue",
    )
    log_step(
        "ORCH_EXPERIMENT",
        f"Scheduled experiment {experiment_id} with GPU={assigned_gpu or 'None'}",
    )
    
    emit_event("AGENT_START", {
        "agent_id": str(experiment_id),
        "hypothesis": hypothesis,
        "gpu": assigned_gpu,
        "status": "starting"
    })

    # Build the command for the single-agent process.
    main_path = os.path.join(os.path.dirname(__file__), "main.py")
    cmd: List[str] = [
        sys.executable,
        main_path,
        hypothesis,
        "--mode",
        "single",
    ]
    if assigned_gpu:
        cmd.extend(["--gpu", assigned_gpu])
    if test_mode:
        cmd.append("--test-mode")

    print_status(
        f"[Experiment {experiment_id}] Spawning single-agent process with command: "
        f"{' '.join(cmd)}",
        "dim",
    )

    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
    )

    stdout_chunks: List[str] = []
    stderr_chunks: List[str] = []

    def _reader(stream, chunks: List[str], is_err: bool) -> None:
        """Read from a subprocess stream, streaming to CLI and capturing for transcript."""
        prefix = f"[Agent {experiment_id}] "
        for line in stream:
            chunks.append(line)
            target = sys.stderr if is_err else sys.stdout
            # Prefix the output for the frontend parser, but keep the raw line for the transcript
            target.write(f"{prefix}{line}")
            target.flush()

    # Stream stdout and stderr concurrently.
    t_out = threading.Thread(
        target=_reader, args=(proc.stdout, stdout_chunks, False), daemon=True
    )
    t_err = threading.Thread(
        target=_reader, args=(proc.stderr, stderr_chunks, True), daemon=True
    )

    t_out.start()
    t_err.start()

    exit_code = proc.wait()
    t_out.join()
    t_err.join()

    print_status(
        f"[Experiment {experiment_id}] Completed with exit code {exit_code}",
        "bold blue",
    )

    emit_event("AGENT_COMPLETE", {
        "agent_id": str(experiment_id),
        "exit_code": exit_code
    })

    transcript = (
        f"=== Experiment {experiment_id} Transcript ===\n"
        f"GPU: {assigned_gpu or 'CPU-only / default'}\n"
        f"Hypothesis: {hypothesis}\n"
        f"Exit code: {exit_code}\n"
        f"\n--- STDOUT ---\n"
        + "".join(stdout_chunks)
        + "\n--- STDERR ---\n"
        + "".join(stderr_chunks)
    )

    # Guard against enormous transcripts.
    max_len = 120_000
    if len(transcript) > max_len:
        transcript = (
            transcript[:max_len]
            + "\n...[TRANSCRIPT TRUNCATED BY ORCHESTRATOR FOR CONTEXT SIZE]...\n"
        )

    result: Dict[str, Any] = {
        "experiment_id": experiment_id,
        "hypothesis": hypothesis,
        "gpu": assigned_gpu,
        "exit_code": exit_code,
        "transcript": transcript,
    }

    return result


def run_orchestrator_loop(
    research_task: str,
    num_initial_agents: int = 3,
    max_rounds: int = 3,
    default_gpu: Optional[str] = None,
    max_parallel_experiments: int = 2,
    test_mode: bool = False,
) -> None:
    """
    Main orchestrator loop using Gemini 3 Pro with thinking + manual tool calling.

    Args:
        research_task: High-level research question or task to investigate.
        num_initial_agents: How many distinct hypotheses to target in the first wave.
        max_rounds: Soft cap on how many orchestration steps/waves to perform.
        default_gpu: Default GPU string for experiments (or None for CPU-only).
        max_parallel_experiments: Maximum number of experiments to run in parallel
                                  in a single wave of tool calls.
        test_mode: If True, runs in test mode with mock data.
    """
    global _default_gpu
    _default_gpu = default_gpu

    print_panel(
        f"Research Task:\n{research_task}",
        "Orchestrator: Starting Research Project",
        "bold magenta",
    )
    log_step("ORCH_START", f"Research Task: {research_task}")
    print_status(
        f"Orchestrator configuration: {num_initial_agents} initial agents, "
        f"up to {max_rounds} rounds.",
        "info",
    )
    print_status(
        f"Default GPU for experiments: {default_gpu or 'CPU-only / none'}",
        "info",
    )
    print_status(
        f"Maximum parallel experiments per wave: {max_parallel_experiments}",
        "info",
    )
    
    if test_mode:
        print_status("TEST MODE ENABLED: Using mock data and skipping LLM calls.", "bold yellow")
        import time
        
        # Mock Orchestrator Loop
        mock_hypotheses = [
            f"Hypothesis A: {research_task} can be solved by method X.",
            f"Hypothesis B: {research_task} requires method Y optimization.",
            f"Hypothesis C: {research_task} is sensitive to hyperparameter Z."
        ]
        
        # Step 1: Initial Thinking
        thought = (
            "I need to decompose the research task into testable hypotheses.\n\n"
            "Based on the request, I will investigate three main directions:\n"
            "1. Method X applicability\n"
            "2. Method Y optimization\n"
            "3. Hyperparameter Z sensitivity\n"
            "I will launch agents to test these concurrently."
        )
        print_panel(thought, "Orchestrator Thinking", "thought")
        log_step("ORCH_THOUGHT", thought)
        emit_event("ORCH_THOUGHT", {"thought": thought})
        time.sleep(2)
        
        # Step 2: Launch Experiments
        print_status(f"Launching {len(mock_hypotheses)} experiment(s) with up to {max_parallel_experiments} in parallel...", "info")
        
        with ThreadPoolExecutor(max_workers=max_parallel_experiments) as executor:
            futures = []
            for i, hyp in enumerate(mock_hypotheses):
                futures.append(executor.submit(run_researcher, hyp, default_gpu, True))
            
            for future in futures:
                result = future.result()
                print_panel(
                    json.dumps(result, indent=2, ensure_ascii=False),
                    "Orchestrator Tool Result",
                    "result",
                )
                log_step("ORCH_TOOL_RESULT", "run_researcher completed")
        
        # Step 3: Synthesis Thinking
        thought = (
            "The experiments have completed.\n"
            "Agent A reported success with Method X.\n"
            "Agent B found Method Y to be unstable.\n"
            "Agent C confirmed sensitivity to Z.\n"
            "I have sufficient evidence to write the final paper."
        )
        print_panel(thought, "Orchestrator Thinking", "thought")
        log_step("ORCH_THOUGHT", thought)
        emit_event("ORCH_THOUGHT", {"thought": thought})
        time.sleep(2)
        
        # Step 4: Final Paper
        final_paper = (
            "# Research Report: " + research_task + "\n\n"
            "## Abstract\n"
            "We investigated " + research_task + " using a multi-agent approach. "
            "Our findings suggest Method X is superior.\n\n"
            "## Introduction\n"
            "This is a mock paper generated in Test Mode.\n\n"
            "## Results\n"
            "- Method X: 95% accuracy\n"
            "- Method Y: Unstable convergence\n\n"
            "## Conclusion\n"
            "Method X is recommended.\n\n"
            "[DONE]"
        )
        print_panel(final_paper, "Final Paper", "bold green")
        log_step("ORCH_FINAL", "Final paper generated.")
        emit_event("ORCH_PAPER", {"content": final_paper})
        return

    print_status("Gemini thinking: HIGH (thought summaries visible)", "info")

    client = genai.Client(api_key=os.environ["GOOGLE_API_KEY"])

    tools = [run_researcher]
    system_prompt = _build_orchestrator_system_prompt(
        num_initial_agents=num_initial_agents,
        max_rounds=max_rounds,
        default_gpu_hint=default_gpu,
        max_parallel_experiments=max_parallel_experiments,
    )

    # Initial conversation: just the research task as a user message.
    history: List[types.Content] = [
        types.Content(
            role="user",
            parts=[
                types.Part.from_text(
                    text=(
                        "High-level research task:\n"
                        f"{research_task}\n\n"
                        "Begin by decomposing this into concrete hypotheses and planning "
                        "which ones require empirical validation. When appropriate, "
                        "call run_researcher for hypotheses that need experiments."
                    )
                )
            ],
        )
    ]

    # Track experiments for a compact summary view in the CLI.
    all_experiments: List[Dict[str, Any]] = []

    max_steps = max(8, max_rounds * 3)

    for step in range(1, max_steps + 1):
        print_status(f"Orchestrator step {step}...", "dim")

        try:
            response = client.models.generate_content(
                model="gemini-3-pro-preview",
                contents=history,
                config=_build_orchestrator_generation_config(
                    tools=tools,
                    system_instruction=system_prompt,
                    disable_autofc=True,
                ),
            )
        except Exception as e:
            print_status(f"Orchestrator API Error: {e}", "error")
            logger.error(f"Orchestrator API Error: {e}")
            break

        if not response.candidates:
            print_status("Orchestrator: empty response from model.", "warning")
            break

        candidate = response.candidates[0]
        model_content = candidate.content

        if not model_content or not model_content.parts:
            print_status("Orchestrator: empty content from model.", "warning")
            break

        # Append full model message (including thoughts & function calls) to preserve state.
        history.append(model_content)

        thoughts: List[str] = []
        messages: List[str] = []
        function_calls: List[Any] = []

        for part in model_content.parts:
            # Thought summaries from thinking mode.
            if getattr(part, "thought", False) and part.text:
                thoughts.append(part.text)

            # Function/tool call parts.
            if part.function_call:
                function_calls.append(part.function_call)

            # Regular assistant text (exclude thought parts so we don't double-print).
            if part.text and not getattr(part, "thought", False):
                messages.append(part.text)

        # 1. Show reasoning before any action.
        if thoughts:
            joined_thoughts = "\n\n".join(thoughts)
            print_panel(joined_thoughts, "Orchestrator Thinking", "thought")
            log_step("ORCH_THOUGHT", joined_thoughts)
            emit_event("ORCH_THOUGHT", {"thought": joined_thoughts})

        # 2. Show natural-language messages (plans, explanations, etc.).
        if messages:
            joined_messages = "\n\n".join(messages)
            print_panel(joined_messages, "Orchestrator Message", "info")
            log_step("ORCH_MODEL", joined_messages)

        combined_text = "\n".join(thoughts + messages)
        if "[DONE]" in combined_text:
            # Orchestrator already produced the final paper and signaled completion.
            # We need to emit the paper event so the frontend displays it.
            if messages:
                final_content = "\n\n".join(messages)
                # Clean up the [DONE] token for better display
                display_content = final_content.replace("[DONE]", "").strip()
                
                if display_content:
                    print_panel(display_content, "Final Paper", "bold green")
                    log_step("ORCH_FINAL", "Final paper generated (in loop).")
                    emit_event("ORCH_PAPER", {"content": display_content})

            print_status("Orchestrator signaled completion.", "success")
            return

        # If the model didn't call any tools this turn, assume we're done.
        if not function_calls:
            print_status(
                "Orchestrator: no tool calls in this step; assuming research is complete.",
                "info",
            )
            break

        # 3. Execute requested tools (run_researcher) in parallel where possible.
        results_for_history: List[Dict[str, Any]] = []

        def _execute_single_call(fn_call) -> Dict[str, Any]:
            fn_name = fn_call.name
            fn_args = dict(fn_call.args or {})

            print_panel(
                f"{fn_name}({json.dumps(fn_args, indent=2)})",
                "Orchestrator Tool Call",
                "code",
            )
            log_step("ORCH_TOOL_CALL", f"{fn_name}({fn_args})")
            emit_event("ORCH_TOOL", {"tool": fn_name, "args": fn_args})

            if fn_name == "run_researcher":
                return run_researcher(**fn_args)
            else:
                return {
                    "error": (
                        f"Unsupported tool '{fn_name}'. "
                        "Only 'run_researcher' is available."
                    )
                }

        max_workers = max(1, min(max_parallel_experiments, len(function_calls)))
        print_status(
            f"Launching {len(function_calls)} experiment(s) "
            f"with up to {max_workers} in parallel...",
            "info",
        )

        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = [executor.submit(_execute_single_call, fc) for fc in function_calls]

            # Wait for all to complete; display each result as it finishes.
            for future in futures:
                result = future.result()

                # Prepare a human-readable, truncated view for the CLI.
                display_result = result
                if isinstance(result, dict):
                    display_result = dict(result)  # shallow copy
                    transcript = display_result.get("transcript", "")
                    if isinstance(transcript, str) and len(transcript) > 4000:
                        display_result["transcript"] = (
                            transcript[:4000]
                            + "\n...[TRANSCRIPT TRUNCATED IN VIEW; "
                            "FULL TEXT PASSED BACK TO MODEL]..."
                        )

                print_panel(
                    json.dumps(display_result, indent=2, ensure_ascii=False),
                    "Orchestrator Tool Result",
                    "result",
                )
                log_step("ORCH_TOOL_RESULT", "run_researcher completed")

                results_for_history.append(result)

                if isinstance(result, dict) and "experiment_id" in result:
                    all_experiments.append(result)

        # Feed each tool response back as a TOOL message with a functionResponse part.
        for result in results_for_history:
            history.append(
                types.Content(
                    role="tool",
                    parts=[
                        types.Part.from_function_response(
                            name="run_researcher",
                            response={"result": result},
                        )
                    ],
                )
            )

        # Show a compact summary of all experiments so far to keep the CLI readable.
        if all_experiments:
            summary_lines: List[str] = []
            for exp in all_experiments:
                hyp_snippet = (exp.get("hypothesis", "") or "").replace("\n", " ")
                if len(hyp_snippet) > 80:
                    hyp_snippet = hyp_snippet[:77] + "..."
                summary_lines.append(
                    f"Exp {exp.get('experiment_id')} | "
                    f"GPU={exp.get('gpu') or 'CPU'} | "
                    f"exit={exp.get('exit_code')} | "
                    f"{hyp_snippet}"
                )

            print_panel(
                "\n".join(summary_lines),
                "Orchestrator: Experiments So Far",
                "dim",
            )
            log_step("ORCH_SUMMARY", f"{len(all_experiments)} experiments run so far")

    # Safety net: if we exited the loop without an explicit [DONE], ask for the final paper now.
    print_status(
        "Orchestrator loop ended without explicit [DONE]. Requesting final paper...",
        "bold yellow",
    )
    history.append(
        types.Content(
            role="user",
            parts=[
                types.Part.from_text(
                    text=(
                        "Using everything above (including all transcripts and notes), "
                        "write the final Arxiv-style paper as specified in the system prompt. "
                        "When you are finished, end with a line containing only [DONE]."
                    )
                )
            ],
        )
    )

    try:
        final_response = client.models.generate_content(
            model="gemini-3-pro-preview",
            contents=history,
            config=_build_orchestrator_generation_config(
                tools=None,
                system_instruction=system_prompt,
                disable_autofc=True,
            ),
        )
        final_text = final_response.text or ""
        print_panel(final_text, "Final Paper", "bold green")
        log_step("ORCH_FINAL", "Final paper generated.")
        emit_event("ORCH_PAPER", {"content": final_text})
    except Exception as e:
        print_status(f"Failed to generate final paper: {e}", "error")
        logger.error(f"Failed to generate final paper: {e}")