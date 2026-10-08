# pi-grenough

Pi runs natively on Windows; GRENOUGH runs in Ubuntu 24.04 on WSL2.
The extension discovers model IDs and context limits from `/v1/models` and
uses Pi's built-in OpenAI Chat Completions streaming adapter for text and tools.

```powershell
pi install ./pi-grenough
pi --provider grenough --model GRENOUGH-Qwen3.8-27B
```

Loading Pi and selecting GRENOUGH use the local catalog immediately, without
network requests or WSL startup. The engine starts on the first model request,
or explicitly with `/grenough start`. A last-observed catalog remains available when offline;
`/grenough info` distinguishes cached metadata from a live connection.

Commands:

The status line displays the server's actual prefill/decode tok/s and output
token count during streaming and after completion. These use NInfer's cumulative
`timings`, not the number of SSE chunks. TTFT is measured at the client from
request readiness to the first content, reasoning, or tool delta; it is not
GPU-only prefill time. Model loading happens before that timer starts.
The previous speed display stays visible while the next request waits for its
first token, and is replaced only when new server timings arrive.

- `/grenough`: browse and select models.
- `/grenough info`: server status, context limit and output limit.
- `/grenough refresh`: rediscover model metadata.
- `/grenough start`: start the WSL engine.
- `/grenough stop`: stop a Pi-managed engine and release GPU memory.

Settings in `~/.pi/agent/settings.json`:

```json
{
  "grenoughSettings": {
    "url": "http://127.0.0.1:8080",
    "distro": "Ubuntu-24.04",
    "engineRoot": "/home/admin/grenough",
    "profile": "mtp_k8v4",
    "merge": "warp",
    "splitCap": 4,
    "maxTokens": 16384,
    "autoStart": true,
    "stopOnExit": true
  }
}
```

`GRENOUGH_SERVER_URL` overrides the server URL. Automatic engine controls apply
only to a local Windows/WSL HTTP endpoint. An externally started server is never
stopped automatically. Exiting the Pi session that started its engine stops that
engine by default; set `stopOnExit: false` to retain it across sessions. Other Pi
sessions sharing that engine should keep its owning session open.

Thinking defaults to off and can be changed in Pi with Shift+Tab.
Pi sends the selected level as `reasoning_effort`; off maps to `none`.
Only off, low, medium, and xhigh are exposed. Qwen3.8-27B officially supports
low, medium, and xhigh, plus disabling thinking. Other Pi levels are unsupported.
Pi's approximate token descriptions are generic UI hints; this extension does
not turn them into hard thinking budgets. The configured output limit includes
both reasoning and the final answer.
Reference: https://huggingface.co/Qwen/Qwen3.8-27B
The engine's `--no-thinking` flag sets a default that per-request effort overrides.
The shipped deployment is text-only, with MTP3 and K8V4. A
262,144-token configured context is model metadata, not a claim that every
full-context workload has passed quality or residency qualification. This package
does not run benchmarks, download weights or change GPU clocks/power settings.

Based on Pi's documented provider/package APIs and the browsing workflow of
[pi-llama-cpp](https://pi.dev/packages/pi-llama-cpp); it uses GRENOUGH's API and
does not depend on llama.cpp-specific `/props`, router or load/unload endpoints.
