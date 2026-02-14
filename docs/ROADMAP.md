# Roadmap

## Performance Improvements

### ProjectRegistry: Proper change detection for saves

The current `updateWorkspacePr` method uses a simple equality check to avoid unnecessary saves:

```typescript
const changed = pr
  ? wt.prNumber !== pr.number || wt.prUrl !== pr.url || wt.prState !== pr.state
  : wt.prNumber !== undefined || wt.prUrl !== undefined || wt.prState !== undefined
```

A more robust approach would be to compute a diff of the entire projects array before saving, similar to how we should handle all persistence - only write when the serialized output would actually differ from what's on disk. This could be implemented as:

1. Hash the current state after load
2. Before any save, compare hash of new state vs stored hash
3. Only write if hashes differ

This would provide a general solution for all ProjectRegistry saves, not just PR updates.
