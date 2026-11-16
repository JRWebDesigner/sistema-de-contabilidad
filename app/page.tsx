import AdminSystem from '@/components/admin-system'
import { GlobalLoadingProvider } from '@/components/global-loading'

export default function Page() {
  return (
    <GlobalLoadingProvider>
      <AdminSystem />
    </GlobalLoadingProvider>
  )
}
