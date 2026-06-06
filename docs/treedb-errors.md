# TreeDB SDK Errors

TreeDB SDK requests throw `TreeDbApiError` for API, network, timeout, and local validation failures.

```ts
import { TreeDbApiError } from '@treeseed/sdk/treedb';

try {
  await client.searchRepositoryFiles({ query: 'release' });
} catch (error) {
  if (error instanceof TreeDbApiError) {
    console.error(error.code, error.status, error.details);
  }
}
```

`TreeDbApiError` preserves:

- `code`
- `status`
- `payload`
- `details`

## Common Codes

- `authentication_required`
- `invalid_token`
- `permission_denied`
- `workspace_revoked`
- `not_found`
- `conflict`
- `payload_too_large`
- `unsupported_media_type`
- `validation_error`
- `graph_not_ready`
- `network_error`
- `timeout`
- `partial_failure`
- `federated_node_unavailable`
- `federated_node_timeout`
- `federated_scope_empty`
- `unsupported_transport`
- `sandbox_unavailable`
- `storage_compaction_failed`
- `backup_failed`
- `service_unavailable`

Network failures use `status: 0` and `code: "network_error"`. SDK timeout failures use `status: 0`, `code: "timeout"`, and `details.timeoutMs`.

Readiness and deep health failures use `service_unavailable` with HTTP 503 and
sanitized check details.

## Partial Federation

Federated partial failures are normally returned in successful payloads when `includeErrors: true`. When a server rejects the whole request, the SDK preserves the response envelope in `TreeDbApiError.payload`.
