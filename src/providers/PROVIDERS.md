# Providers

Each provider needs a function that converts messages from the user, into it's own format, hence functions like `toOllamaMessage` and `toGeminiContent`.

## Ollama

Tools in Ollama take in functions with parameters, hence the function `toOllamaTool`

## Gemini

Tools in gemini are called functions, hence the function `toFunctionDeclaration`

Tool results are sent back as "user" content with a functionResponse part. Gemini expects an object for `response` so plain text is wrapped.

```typescript
case "tool":
    return {
        role: "user",
        parts: [
            {
                functionResponse: {
                    id: m.toolCallId,
                    name: m.name,
                    response: { output: m.content },
                },
            },
        ],
    };
```
