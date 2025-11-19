import os
import json
from typing import Optional, List, Dict, Any

from google import genai
from google.genai import types

import agent as agent_module
from agent import _build_generation_config

from logger import print_panel as base_print_panel, print_status, log_step, logger

# Global state for orchestrator
_selected_gpu_for_subagents: Optional[str] = None
_experiment_counter: int = 0


def _build_orchestrator_system_prompt(
    num_agents_hint: int, gpu_hint: str
) -> str:
    """System-level instructions for the orchestrator agent."""
    return f"""You are a principal investigator orchestrating up to {num_agents_hint} autonomous research agents.

Your goal is to design and manage an end-to-end research program that answers the user's research_task using empirical
experiments carried out by specialized research agents.

Tool:
- run_single_researcher_agent(hypothesis: str) -> RunResult
  - Runs a full experiment cycle inside a dedicated research agent that executes Python in a Modal sandbox
    with GPU hint: {gpu_hint}.
  - The agent will design and run experiments, then return a concise natural-language report.
  - The RunResult object has:
      - experiment_id: str
      - hypothesis: str
      - report: str

Working style:
1. Begin by restating the research_task, listing key sub-questions and candidate hypotheses.
2. Batch experiments: propose a small set of clear, focused hypotheses and call run_single_researcher_agent
   once for each hypothesis you want tested.
3. After each batch, carefully read and synthesize the returned reports. Decide what you've learned and
   what remains uncertain.
4. If more evidence is needed, design sharper follow-up hypotheses and call the tool again.
5. When you are satisfied that the evidence is sufficient, stop calling tools and focus on writing a complete
   arXiv-style paper that answers the research_task.

ArXiv-style paper requirements:
- Use markdown with LaTeX-style math where helpful.
- Include, in order:
  - Title
  - Authors (you may use placeholder names or "AI Researcher")
  - Abstract
  - 1. Introduction
  - 2. Related Work (high-level, based only on general knowledge you already have)
  - 3. Method
  - 4. Experiments
  - 5. Results
  - 6. Discussion
  - 7. Conclusion
  - 8. Limitations & Future Work
- Heavily reference the concrete experiments and findings produced by your research agents.

Important:
- Be explicit about each experiment you request: why you're running it and what evidence you expect.
- Think step-by-step; your thoughts will be shown to the user.
- Do not fabricate tool results; only rely on what run_single_researcher_agent actually returns.
- When you have finished writing the paper, end your final message with a line that contains only: [DONE].
"""


def run_single_researcher_agent(hypothesis: str) -> Dict[str, str]:
    """
    Tool wrapper that runs a full single-researcher agent experiment and
    captures its final report without modifying the agent implementation.
    """
    global _experiment_counter
    _experiment_counter += 1
    experiment_id = _experiment_counter

    log_step("ORCH_TOOL", f"[experiment {experiment_id}] Starting single-researcher agent")
    print_status(
        f"[Orchestrator] Launching experiment {experiment_id} for hypothesis:",
        "bold cyan",
    )
    base_print_panel(hypothesis, f"Experiment {experiment_id}: Hypothesis", "code")

    # Configure the agent's GPU preference for this run.
    agent_module._selected_gpu = _selected_gpu_for_subagents

    # Monkey-patch agent.print_panel to capture the "Final Report" panel.
    original_print_panel = agent_module.print_panel
    captured: Dict[str, Any] = {"report": None}

    def wrapped_print_panel(*args, **kwargs):
        # Expected signature: (text, title, style), but we accept any form.
        title = None
        if "title" in kwargs:
            title = kwargs["title"]
        elif len(args) >= 2:
            title = args[1]

        if title == "Final Report" and len(args) >= 1:
            captured["report"] = str(args[0])

        # Forward to original for normal CLI rendering.
        return original_print_panel(*args, **kwargs)

    agent_module.print_panel = wrapped_print_panel

    try:
        agent_module.run_experiment_loop(hypothesis)
    except Exception as e:
        log_step("ORCH_TOOL_ERROR", f"[experiment {experiment_id}] {e}")
        print_status(
            f"[Orchestrator] Experiment {experiment_id} failed: {e}",
            "bold red",
        )
        report_text = f"Experiment {experiment_id} failed with error: {e!r}"
    else:
        report_text = captured["report"] or (
            "No explicit final report panel was captured from the agent. "
            "Rely on the printed experiment trace for details."
        )
    finally:
        # Always restore the original function to avoid side effects.
        agent_module.print_panel = original_print_panel

    log_step("ORCH_TOOL", f"[experiment {experiment_id}] Finished single-researcher agent")
    base_print_panel(report_text, f"Experiment {experiment_id}: Agent Report", "result")

    return {
        "experiment_id": str(experiment_id),
        "hypothesis": hypothesis,
        "report": report_text,
    }


def run_orchestrator_loop(
    research_task: str,
    num_agents: int = 3,
    gpu: Optional[str] = None,
    max_steps: int = 10,
):
    """
    Top-level orchestrator loop that uses Gemini 3 Pro to coordinate
    multiple single-researcher agents and produce an arXiv-style paper.
    """
    global _selected_gpu_for_subagents
    _selected_gpu_for_subagents = gpu

    gpu_hint = gpu or "CPU"

    base_print_panel(
        f"Research task: {research_task}",
        "Orchestrator: Starting Program",
        "bold magenta",
    )
    print_status("Orchestrator using Gemini model: gemini-3-pro-preview", "info")
    print_status(f"Conceptual team size (n agents): {num_agents}", "info")
    print_status(f"Sandbox GPU request for experiments: {gpu_hint}", "info")
    log_step("ORCH_START", f"Task: {research_task}")

    client = genai.Client(api_key=os.environ["GOOGLE_API_KEY"])

    tools = [run_single_researcher_agent]
    system_prompt = _build_orchestrator_system_prompt(num_agents, gpu_hint)

    # Initial conversation: just the research task as a user message.
    history: List[types.Content] = [
        types.Content(
            role="user",
            parts=[
                types.Part.from_text(
                    text=(
                        f"Research_task: {research_task}\n\n"
                        f"You control up to {num_agents} single-researcher agents. "
                        f"Use run_single_researcher_agent whenever you need new experimental evidence."
                    )
                )
            ],
        )
    ]

    for step in range(1, max_steps + 1):
        print_status(f"[Orchestrator] Step {step}...", "dim")

        try:
            response = client.models.generate_content(
                model="gemini-3-pro-preview",
                contents=history,
                config=_build_generation_config(
                    tools=tools,
                    system_instruction=system_prompt,
                    disable_autofc=True,  # manual tool loop
                ),
            )
        except Exception as e:
            print_status(f"[Orchestrator] API Error: {e}", "error")
            logger.error(f"[Orchestrator] API Error: {e}")
            break

        if not response.candidates:
            print_status("[Orchestrator] Empty response from model.", "warning")
            break

        candidate = response.candidates[0]
        model_content = candidate.content

        if not model_content or not model_content.parts:
            print_status("[Orchestrator] Empty content from model.", "warning")
            break

        # Append the raw assistant message (including thought + function parts).
        history.append(model_content)

        thoughts: List[str] = []
        messages: List[str] = []
        function_calls = []

        for part in model_content.parts:
            if getattr(part, "thought", False) and part.text:
                thoughts.append(part.text)
            if part.function_call:
                function_calls.append(part.function_call)
            if part.text and not getattr(part, "thought", False):
                messages.append(part.text)

        if thoughts:
            joined_thoughts = "\n\n".join(thoughts)
            base_print_panel(joined_thoughts, "Orchestrator Thinking", "thought")
            log_step("ORCH_THOUGHT", joined_thoughts)

        if messages:
            joined_messages = "\n\n".join(messages)
            base_print_panel(joined_messages, "Orchestrator Message", "info")
            log_step("ORCH_MODEL", joined_messages)

        combined_text = "\n".join(thoughts + messages)
        if "[DONE]" in combined_text:
            print_status("[Orchestrator] Model signaled completion.", "success")
            break

        if not function_calls:
            print_status(
                "[Orchestrator] No tool calls this step; assuming it moved toward writing the paper.",
                "info",
            )
            # Let the orchestrator continue thinking or move directly to the final paper
            # in subsequent steps.
            continue

        # Execute any requested tools.
        for fn_call in function_calls:
            fn_name = fn_call.name
            fn_args = dict(fn_call.args or {})

            pretty_args = json.dumps(fn_args, indent=2)
            base_print_panel(
                f"{fn_name}({pretty_args})",
                "Orchestrator Tool Call",
                "code",
            )
            log_step("ORCH_TOOL_CALL", f"{fn_name}({pretty_args})")

            if fn_name == "run_single_researcher_agent":
                result = run_single_researcher_agent(**fn_args)
            else:
                result = {
                    "error": (
                        f"Unsupported tool '{fn_name}'. "
                        "Only 'run_single_researcher_agent' is available at the orchestrator level."
                    )
                }

            # Truncate very long JSON payloads to keep console readable.
            result_str = json.dumps(result, indent=2)
            if len(result_str) > 20000:
                result_str = (
                    result_str[:10000] + "\n...[TRUNCATED]...\n" + result_str[-10000:]
                )

            base_print_panel(result_str, "Orchestrator Tool Result", "result")
            log_step("ORCH_TOOL_RESULT", "Executed")

            # Feed tool response back to the model.
            history.append(
                types.Content(
                    role="tool",
                    parts=[
                        types.Part.from_function_response(
                            name=fn_name,
                            response={"result": result},
                        )
                    ],
                )
            )

    # Final paper generation.
    try:
        print_status(
            "[Orchestrator] Generating final arXiv-style paper...",
            "bold green",
        )
        history.append(
            types.Content(
                role="user",
                parts=[
                    types.Part.from_text(
                        text=(
                            "Based on all previous discussion and tool results, "
                            "write the full arXiv-style research paper now. "
                            "Remember to end your response with a line that contains only [DONE]."
                        )
                    )
                ],
            )
        )

        final_response = client.models.generate_content(
            model="gemini-3-pro-preview",
            contents=history,
            config=_build_generation_config(
                tools=None,
                system_instruction=system_prompt,
                disable_autofc=True,
            ),
        )

        final_text = final_response.text or ""
        base_print_panel(final_text, "Orchestrator: Final Paper", "bold green")
    finally:
        print_status("[Orchestrator] Program finished.", "bold cyan")