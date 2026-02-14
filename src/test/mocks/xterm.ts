export class Terminal {
  cols = 80
  rows = 24
  loadAddon() {}
  open() {}
  onData() {
    return { dispose: () => {} }
  }
  write() {}
  dispose() {}
}
