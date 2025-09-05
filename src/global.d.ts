declare global {
  function setTimeout(handler: () => void, timeout: number): number
}

export {}
