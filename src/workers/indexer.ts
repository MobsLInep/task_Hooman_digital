process.parentPort?.on('message', (event) => {
  const [port] = event.ports
  port?.postMessage({ type: 'ready' })
})
