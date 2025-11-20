from __future__ import annotations

import json
import queue
import re
import subprocess
import sys
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Literal

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

# Load environment variables from the repo's .env file so spawned processes inherit them.
BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

MAIN_PATH = BASE_DIR / "main.py"

# Regex for stripping ANSI escape sequences (Rich colour codes, etc.).
ANSI_ESCAPE_RE = re.compile(r"\x1B\[[0-?]*[ -/]*[@-~]")


def strip_ansi(text: str) -> str:
    """
    Remove ANSI colour / style escape sequences from terminal output.

    This is useful for building UIs that want plain text, while still
    retaining the original coloured output for advanced terminals.
    """
    return ANSI_ESCAPE_RE.sub("", text)


class SingleExperimentRequest(BaseModel):
    """
    Request body for running a single-agent experiment.

    This directly maps to:
        python main.py "<task>" --mode single [--gpu GPU]
    """

    task: str = Field(
        ...,
        description=(
            "A short natural-language hypothesis to test. This is passed to the "
            "single research agent as the main experiment description."
        ),
        examples=[
            "Fine-tuning a small transformer on CIFAR-10 improves accuracy by more than 5%."
        ],
    )
    gpu: Optional[str] = Field(
        None,
        description=(
            "Optional GPU type to request for the Modal sandbox. "
            "Examples: 'T4', 'A10G', 'A100', 'any'. "
            "If omitted, the system uses its default (CPU-only or configured GPU)."
        ),
        examples=["T4"],
    )
    test_mode: bool = Field(
        False,
        description="If true, runs in test mode with mock data (no LLM/GPU usage).",
    )


class OrchestratorExperimentRequest(BaseModel):
    """
    Request body for running the multi-agent orchestrator.

    This maps to:
        python main.py "<task>" --mode orchestrator \\
            --num-agents N --max-rounds R --max-parallel P [--gpu GPU]
    """

    task: str = Field(
        ...,
        description=(
            "High-level research question for the orchestrator to investigate. "
            "The orchestrator will decompose this into multiple hypotheses and "
            "launch single-agent experiments as needed."
        ),
        examples=[
            "Characterize the scaling behaviour of depth vs width in small transformers."
        ],
    )
    gpu: Optional[str] = Field(
        None,
        description=(
            "Default GPU hint for experiments spawned by the orchestrator "
            "(e.g. 'T4', 'A10G', 'A100', 'any'). If omitted, falls back to the "
            "host default (CPU-only or configured GPU)."
        ),
        examples=["A10G"],
    )
    num_agents: int = Field(
        3,
        ge=1,
        le=16,
        description=(
            "How many distinct single-agent researchers to launch in the first wave. "
            "This is passed as --num-agents."
        ),
    )
    max_rounds: int = Field(
        3,
        ge=1,
        le=10,
        description=(
            "Maximum number of orchestration rounds (waves of experiments). "
            "This is passed as --max-rounds."
        ),
    )
    max_parallel: int = Field(
        2,
        ge=1,
        le=16,
        description=(
            "Maximum number of experiments to run in parallel in a single wave. "
            "This is passed as --max-parallel."
        ),
    )
    test_mode: bool = Field(
        False,
        description="If true, runs in test mode with mock data (no LLM/GPU usage).",
    )


class ProcessSummary(BaseModel):
    """
    Structured view of a completed CLI run.

    The stdout/stderr fields preserve all Rich formatting escape codes,
    while the *_plain variants provide the same content with ANSI codes stripped
    for easy rendering in front-ends.
    """

    mode: Literal["single", "orchestrator"] = Field(
        ...,
        description="Which execution mode was used.",
    )
    task: str = Field(
        ...,
        description="Original task/hypothesis passed to main.py.",
    )
    gpu: Optional[str] = Field(
        None,
        description="GPU hint passed to main.py (if any).",
    )
    command: List[str] = Field(
        ...,
        description="Exact command invoked by the API to run the experiment.",
    )
    started_at: datetime = Field(
        ...,
        description="UTC timestamp when the subprocess started.",
    )
    finished_at: datetime = Field(
        ...,
        description="UTC timestamp when the subprocess finished.",
    )
    duration_seconds: float = Field(
        ...,
        description="Wall-clock run duration in seconds.",
    )
    exit_code: int = Field(
        ...,
        description="Subprocess exit code. Zero usually indicates success.",
    )
    stdout: str = Field(
        ...,
        description="Raw stdout produced by main.py (including ANSI colour codes).",
    )
    stderr: str = Field(
        ...,
        description="Raw stderr produced by main.py (including ANSI colour codes).",
    )
    stdout_plain: str = Field(
        ...,
        description="Stdout with ANSI escape codes stripped for simple rendering.",
    )
    stderr_plain: str = Field(
        ...,
        description="Stderr with ANSI escape codes stripped for simple rendering.",
    )


app = FastAPI(
    title="AI Researcher API",
    description=(
        "Thin HTTP wrapper around the existing CLI-based AI Researcher agents.\n\n"
        "The API does not reimplement any research logic; it simply shells out "
        "to `main.py` and returns everything the CLI prints so that a front-end "
        "can visualise it in rich ways."
    ),
    version="0.1.0",
)

from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _ensure_main_exists() -> None:
    """
    Verify that main.py exists at the expected location.

    If not, raise an HTTPException so callers get a clear error.
    """
    if not MAIN_PATH.exists():
        raise HTTPException(
            status_code=500,
            detail=f"main.py not found at expected path: {MAIN_PATH}",
        )


def _build_single_command(req: SingleExperimentRequest) -> List[str]:
    """
    Build the command to run a single-agent experiment via main.py.
    """
    cmd: List[str] = [
        sys.executable,
        str(MAIN_PATH),
        req.task,
        "--mode",
        "single",
    ]
    if req.gpu:
        cmd.extend(["--gpu", req.gpu])
    if req.test_mode:
        cmd.append("--test-mode")
    return cmd


def _build_orchestrator_command(req: OrchestratorExperimentRequest) -> List[str]:
    """
    Build the command to run the orchestrator via main.py.
    """
    cmd: List[str] = [
        sys.executable,
        str(MAIN_PATH),
        req.task,
        "--mode",
        "orchestrator",
        "--num-agents",
        str(req.num_agents),
        "--max-rounds",
        str(req.max_rounds),
        "--max-parallel",
        str(req.max_parallel),
    ]
    if req.gpu:
        cmd.extend(["--gpu", req.gpu])
    if req.test_mode:
        cmd.append("--test-mode")
    return cmd


def _run_and_capture(
    cmd: List[str],
    *,
    mode: Literal["single", "orchestrator"],
    task: str,
    gpu: Optional[str],
) -> ProcessSummary:
    """
    Run `main.py` as a subprocess and capture all of its stdout/stderr.

    This leaves the underlying CLI behaviour untouched and simply wraps it.
    """
    _ensure_main_exists()

    started_at = datetime.now(timezone.utc)

    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
    )

    stdout_chunks: List[str] = []
    stderr_chunks: List[str] = []

    def _reader(stream, chunks: List[str]) -> None:
        for line in stream:
            chunks.append(line)

    t_out = threading.Thread(
        target=_reader, args=(proc.stdout, stdout_chunks), daemon=True
    )
    t_err = threading.Thread(
        target=_reader, args=(proc.stderr, stderr_chunks), daemon=True
    )

    t_out.start()
    t_err.start()

    exit_code = proc.wait()
    t_out.join()
    t_err.join()

    finished_at = datetime.now(timezone.utc)

    stdout_text = "".join(stdout_chunks)
    stderr_text = "".join(stderr_chunks)

    return ProcessSummary(
        mode=mode,
        task=task,
        gpu=gpu,
        command=cmd,
        started_at=started_at,
        finished_at=finished_at,
        duration_seconds=(finished_at - started_at).total_seconds(),
        exit_code=exit_code,
        stdout=stdout_text,
        stderr=stderr_text,
        stdout_plain=strip_ansi(stdout_text),
        stderr_plain=strip_ansi(stderr_text),
    )


def _stream_subprocess(
    cmd: List[str],
    *,
    meta: Dict[str, Any],
) -> StreamingResponse:
    """
    Stream stdout/stderr from `main.py` as newline-delimited JSON (NDJSON).

    Each line of output is sent as:
        {
          "type": "line",
          "stream": "stdout" | "stderr",
          "timestamp": "<ISO-8601>",
          "raw": "<raw line>",
          "plain": "<line without ANSI>",
          ...meta
        }

    When the process finishes, a final summary event is sent:
        {
          "type": "summary",
          "exit_code": <int>,
          "started_at": "<ISO-8601>",
          "finished_at": "<ISO-8601>",
          "duration_seconds": <float>,
          ...meta
        }
    """
    _ensure_main_exists()

    started_at = datetime.now(timezone.utc)

    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
    )

    # Queue is used to multiplex stdout and stderr into a single ordered stream.
    q: "queue.Queue[Optional[Dict[str, Any]]]" = queue.Queue()

    def _push_line(stream, stream_name: str) -> None:
        for line in stream:
            event: Dict[str, Any] = {
                "type": "line",
                "stream": stream_name,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "raw": line,
                "plain": strip_ansi(line),
            }
            event.update(meta)
            q.put(event)

    def _wait_for_exit() -> None:
        exit_code = proc.wait()
        finished_at = datetime.now(timezone.utc)
        summary: Dict[str, Any] = {
            "type": "summary",
            "timestamp": finished_at.isoformat(),
            "exit_code": exit_code,
            "started_at": started_at.isoformat(),
            "finished_at": finished_at.isoformat(),
            "duration_seconds": (finished_at - started_at).total_seconds(),
        }
        summary.update(meta)
        q.put(summary)
        # Sentinel to tell the iterator to stop.
        q.put(None)

    threading.Thread(
        target=_push_line, args=(proc.stdout, "stdout"), daemon=True
    ).start()
    threading.Thread(
        target=_push_line, args=(proc.stderr, "stderr"), daemon=True
    ).start()
    threading.Thread(target=_wait_for_exit, daemon=True).start()

    def event_iterator():
        while True:
            item = q.get()
            if item is None:
                break
            yield json.dumps(item, ensure_ascii=False) + "\n"

    return StreamingResponse(
        event_iterator(),
        media_type="application/x-ndjson",
    )


@app.get("/api/health", summary="Simple health probe")
def health_check() -> Dict[str, Any]:
    """
    Lightweight health check.

    This does not call Gemini or Modal; it only verifies that `main.py`
    exists on disk and that the API process can see it.
    """
    exists = MAIN_PATH.exists()
    return {
        "status": "ok" if exists else "error",
        "main_py": str(MAIN_PATH),
        "main_py_exists": exists,
    }


@app.get("/api/state", summary="Get global system state")
def get_state() -> Dict[str, Any]:
    """
    Return the current global state of the orchestrator.
    This is primarily to support legacy clients or status monitors.
    """
    # Import here to avoid circular imports if orchestrator imports api_server
    try:
        from orchestrator import _experiment_counter, _default_gpu
        return {
            "status": "active",
            "experiments_run": _experiment_counter,
            "default_gpu": _default_gpu,
        }
    except ImportError:
        return {
            "status": "active",
            "info": "Orchestrator module not loaded",
        }


@app.post(
    "/api/experiments/single",
    response_model=ProcessSummary,
    summary="Run a single-agent experiment (blocking)",
)
def run_single_experiment(req: SingleExperimentRequest) -> ProcessSummary:
    """
    Run the original single-agent researcher and wait for it to finish.

    This endpoint blocks until the underlying CLI command exits, then returns
    a fully structured `ProcessSummary` containing all CLI output.
    """
    cmd = _build_single_command(req)
    return _run_and_capture(
        cmd,
        mode="single",
        task=req.task,
        gpu=req.gpu,
    )


@app.post(
    "/api/experiments/orchestrator",
    response_model=ProcessSummary,
    summary="Run the multi-agent orchestrator (blocking)",
)
def run_orchestrator_experiment(req: OrchestratorExperimentRequest) -> ProcessSummary:
    """
    Run the orchestrator mode end-to-end and wait for it to finish.

    The returned `ProcessSummary` includes all orchestrator logs, experiment
    transcripts, and the final paper generated at the end of the run.
    """
    cmd = _build_orchestrator_command(req)
    return _run_and_capture(
        cmd,
        mode="orchestrator",
        task=req.task,
        gpu=req.gpu,
    )


@app.post(
    "/api/experiments/single/stream",
    summary="Stream a single-agent experiment as newline-delimited JSON",
)
def stream_single_experiment(req: SingleExperimentRequest) -> StreamingResponse:
    """
    Run the single-agent researcher and stream all logs as NDJSON.

    This is ideal for front-ends that want to show real-time logs or
    progressively render the final report as it is produced.
    """
    cmd = _build_single_command(req)
    meta = {
        "mode": "single",
        "task": req.task,
        "gpu": req.gpu,
        "command": cmd,
    }
    return _stream_subprocess(cmd, meta=meta)


@app.post(
    "/api/experiments/orchestrator/stream",
    summary="Stream the orchestrator as newline-delimited JSON",
)
def stream_orchestrator_experiment(
    req: OrchestratorExperimentRequest,
) -> StreamingResponse:
    """
    Run the orchestrator mode and stream all logs as NDJSON.

    The stream includes orchestrator thinking, tool calls, and nested
    single-agent transcripts exactly as printed by the CLI.
    """
    cmd = _build_orchestrator_command(req)
    meta = {
        "mode": "orchestrator",
        "task": req.task,
        "gpu": req.gpu,
        "command": cmd,
    }
    return _stream_subprocess(cmd, meta=meta)


if __name__ == "__main__":
    # Convenience entrypoint so you can run:
    #   python api_server.py
    # during development instead of calling uvicorn manually.
    import uvicorn

    uvicorn.run(
        "api_server:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
    )