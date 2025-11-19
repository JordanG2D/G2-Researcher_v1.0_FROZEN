import sys
import argparse
from dotenv import load_dotenv

from logger import print_status


def main():
    # Load environment variables from .env file
    load_dotenv()

    parser = argparse.ArgumentParser(
        description="AI Research Agent CLI (single-agent and orchestrator modes)"
    )
    parser.add_argument(
        "hypothesis",
        type=str,
        help=(
            "In 'single' mode: the hypothesis to verify.\n"
            "In 'orchestrator' mode: the high-level research task to investigate."
        ),
    )
    parser.add_argument(
        "--gpu",
        type=str,
        default=None,
        help="GPU type to request for the sandbox (e.g., 'T4', 'A10G', 'A100', 'any').",
    )
    parser.add_argument(
        "--mode",
        choices=["single", "orchestrator"],
        default="single",
        help=(
            "Execution mode: 'single' runs a single research agent (original behavior); "
            "'orchestrator' runs the higher-level multi-agent research orchestrator."
        ),
    )
    parser.add_argument(
        "--num-agents",
        type=int,
        default=10,
        help=(
            "Maximum conceptual number of single-researcher agents to coordinate "
            "(orchestrator mode only)."
        ),
    )
    parser.add_argument(
        "--max-steps",
        type=int,
        default=10,
        help=(
            "Maximum number of reasoning/tool steps for the orchestrator before "
            "generating the final paper."
        ),
    )

    args = parser.parse_args()

    if args.mode == "single":
        print_status("Initializing Single Researcher Agent...", "bold cyan")
        try:
            import agent as agent_module
            from agent import run_experiment_loop

            # Record GPU preference globally for sandbox creation
            agent_module._selected_gpu = args.gpu
            run_experiment_loop(args.hypothesis)
        except KeyboardInterrupt:
            print_status("\nExperiment interrupted by user.", "bold red")
            sys.exit(0)
        except Exception as e:
            print_status(f"\nFatal Error (single-agent mode): {e}", "bold red")
            sys.exit(1)
    else:
        print_status("Initializing Orchestrator Agent...", "bold cyan")
        try:
            from orchestrator import run_orchestrator_loop

            run_orchestrator_loop(
                research_task=args.hypothesis,
                num_agents=args.num_agents,
                gpu=args.gpu,
                max_steps=args.max_steps,
            )
        except KeyboardInterrupt:
            print_status("\nOrchestrator run interrupted by user.", "bold red")
            sys.exit(0)
        except Exception as e:
            print_status(f"\nFatal Error (orchestrator mode): {e}", "bold red")
            sys.exit(1)


if __name__ == "__main__":
    main()
