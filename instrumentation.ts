type BillingWorkerState = {
  running: boolean
  interval: ReturnType<typeof setInterval> | null
}

const billingGlobal = globalThis as typeof globalThis & {
  __businessmanBillingWorker?: BillingWorkerState
}

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  if (billingGlobal.__businessmanBillingWorker?.interval) return

  const state: BillingWorkerState = { running: false, interval: null }
  billingGlobal.__businessmanBillingWorker = state

  const runBilling = async () => {
    if (state.running) return
    state.running = true
    try {
      const { billDueSubscriptions } = await import('@/lib/service-billing')
      const billed = await billDueSubscriptions()
      if (billed > 0) console.info(`SERVICE_SUBSCRIPTIONS_BILLED ${billed}`)
    } catch (error) {
      console.error('SERVICE_SUBSCRIPTION_BILLING_FAILED', error)
    } finally {
      state.running = false
    }
  }

  setTimeout(() => void runBilling(), 10_000)
  state.interval = setInterval(() => void runBilling(), 60_000)
}
