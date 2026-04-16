# shakespeare-extension

manipulate selected text from contextual menu for grammatical correction and improvement.

https://github.com/user-attachments/assets/a50a3734-835a-484f-a3fa-4595baa300c8

## quickstart

```bash
env | sort -u | grep -iP '^llama.*'
LLAMA_ARG_CPU_MOE=true
LLAMA_ARG_CTX_CHECKPOINTS=3
LLAMA_ARG_DIO=true
LLAMA_ARG_KV_UNIFIED=true
LLAMA_ARG_PERF=false
LLAMA_ARG_SWA_FULL=true
LLAMA_LOG_FILE=/tmp/llamacpp.log
LLAMA_LOG_VERBOSITY=3

llama-server -hf unsloth/gemma-4-E2B-it-GGUF:Q4_K_S \
  -ngl 99 \
  --ubatch-size 512 --batch-size 2048 \
  --ctx-size 4096 \
  --cache-ram 0 \
  --chat-template-kwargs '{"enable_thinking":false}' \
  --reasoning-budget 0 \
  --threads 8 \
  --fit off \
  --device CUDA0
```

## disclaimer

- coded with an LLM, adjusted, refactored, verified by hand.
- only my own usage in mind.
- inspired by [https://github.com/ProtonMail/WebClients/tree/main/applications/pass-extension](https://github.com/ProtonMail/WebClients/tree/main/applications/pass-extension)
