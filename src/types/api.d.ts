/**
 * Types adapted from llama.cpp upstream:
 * https://github.com/ggml-org/llama.cpp/blob/master/tools/server/webui/src/lib/types/api.d.ts
 */

export interface ApiChatMessageContentPart {
  type: string;
  text?: string;
  image_url?: {
    url: string;
  };
  input_audio?: {
    data: string;
    format: "wav" | "mp3";
  };
}

export interface ApiChatCompletionToolFunction {
  name: string;
  description?: string;
  parameters: Record<string, unknown>;
}

export interface ApiChatCompletionTool {
  type: "function";
  function: ApiChatCompletionToolFunction;
}

export interface ApiChatCompletionToolCallFunctionDelta {
  name?: string;
  arguments?: string;
}

export interface ApiChatCompletionToolCallDelta {
  index?: number;
  id?: string;
  type?: string;
  function?: ApiChatCompletionToolCallFunctionDelta;
}

export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ApiChatCompletionRequest {
  messages: Array<{
    role: ChatRole;
    content: string | ApiChatMessageContentPart[];
    reasoning_content?: string;
    tool_calls?: ApiChatCompletionToolCallDelta[];
    tool_call_id?: string;
  }>;
  stream?: boolean;
  stream_options?: { include_usage: boolean };
  model?: string;
  return_progress?: boolean;
  tools?: ApiChatCompletionTool[];
  /** Reasoning parameters */
  reasoning_format?: string;
  /** Generation parameters */
  temperature?: number;
  max_tokens?: number;
  /** Sampling parameters */
  dynatemp_range?: number;
  dynatemp_exponent?: number;
  top_k?: number;
  top_p?: number;
  min_p?: number;
  xtc_probability?: number;
  xtc_threshold?: number;
  typ_p?: number;
  /** Penalty parameters */
  repeat_last_n?: number;
  repeat_penalty?: number;
  presence_penalty?: number;
  frequency_penalty?: number;
  dry_multiplier?: number;
  dry_base?: number;
  dry_allowed_length?: number;
  dry_penalty_last_n?: number;
  /** Sampler configuration */
  samplers?: string[];
  backend_sampling?: boolean;
  /** Custom parameters (JSON string) */
  custom?: Record<string, unknown>;
  timings_per_token?: boolean;
}

export interface ApiChatCompletionResponse {
  model?: string;
  choices: Array<{
    model?: string;
    metadata?: { model?: string };
    message: {
      content: string;
      reasoning_content?: string;
      model?: string;
      tool_calls?: Array<ApiChatCompletionToolCallDelta & {
        function?: ApiChatCompletionToolCallFunctionDelta & { arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
}

export interface ApiChatCompletionStreamChunk {
  object?: string;
  model?: string;
  choices: Array<{
    model?: string;
    metadata?: { model?: string };
    delta: {
      content?: string;
      reasoning_content?: string;
      model?: string;
      tool_calls?: ApiChatCompletionToolCallDelta[];
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface ApiHealthResponse {
  status: "ok";
}

export interface ApiErrorResponse {
  error:
    | {
        code: number;
        message: string;
        type: "exceed_context_size_error";
        n_prompt_tokens: number;
        n_ctx: number;
      }
    | {
        code: number;
        message: string;
        type?: string;
      };
}
