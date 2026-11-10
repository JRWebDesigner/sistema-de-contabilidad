import { NextResponse } from 'next/server'
import { z } from 'zod'

import { logAudit } from '@/lib/audit'
import { branchContextError, resolveBranchContext } from '@/lib/branches'
import { prisma } from '@/lib/db'
import { requirePermission } from '@/lib/permissions'

const receiptSchema = z.object({ serviceId: z.string().min(1) })

export async function POST(request: Request) {
  const access = await requirePermission(request, 'sales:read')
  if (access.response) return access.response

  const branchContext = await resolveBranchContext(request, access.session)
  const branchError = branchContextError(branchContext)
  if (branchError) return branchError

  const payload = receiptSchema.safeParse(await request.json())
  if (!payload.success) {
    return NextResponse.json({ error: 'Selecciona un servicio válido para imprimir.' }, { status: 400 })
  }

  try {
    const service = await prisma.serviceSubscription.findUnique({
      where: { id: payload.data.serviceId },
      include: {
        customer: { select: { name: true, document: true } },
        serviceProduct: { select: { name: true, sku: true } },
        branch: { select: { id: true, name: true, address: true, phone: true } },
        invoices: {
          orderBy: { createdAt: 'asc' },
          take: 1,
          select: {
            number: true,
            total: true,
            paymentMethod: true,
            paymentReference: true,
            requiresInvoice: true,
            notes: true,
            receivable: { select: { number: true, paidAmount: true, balance: true, dueDate: true, status: true } },
          },
        },
      },
    })

    if (
      !service ||
      (!branchContext.isAll && service.branchId !== branchContext.branchId)
    ) {
      return NextResponse.json({ error: 'El servicio no existe o no pertenece a la sucursal seleccionada.' }, { status: 404 })
    }

    await logAudit({
      request,
      action: 'EXPORT',
      moduleName: 'Servicios',
      entity: 'ServiceStartReceipt',
      entityId: service.id,
      details: `Se imprimió la constancia de inicio del servicio ${service.number}.`,
      newValue: { serviceNumber: service.number, customerId: service.customerId },
    })

    const initialInvoice = service.invoices[0]
    return NextResponse.json({
      title: 'Constancia de inicio de servicio',
      number: service.number,
      date: service.startDate.toISOString(),
      partyName: service.customer.name,
      partyDocument: service.customer.document,
      branchName: service.branch.name,
      branchAddress: service.branch.address,
      branchPhone: service.branch.phone,
      service: {
        code: service.serviceProduct.sku ?? '—',
        contracted: service.serviceProduct.name,
        observation: initialInvoice?.notes ?? '',
        frequency: service.billingPeriod === 'ANNUAL' ? 'Anual' : 'Mensual',
        startDate: service.startDate.toLocaleDateString('es-BO'),
        initialPayment: `Bs ${Number(initialInvoice?.receivable?.paidAmount ?? initialInvoice?.total ?? 0).toFixed(2)}`,
        outstandingBalance: `Bs ${Number(initialInvoice?.receivable?.balance ?? 0).toFixed(2)}`,
      },
    })
  } catch (error) {
    console.error('ERROR_ISSUING_SERVICE_START_NOTE', error)
    return NextResponse.json({ error: 'No se pudo generar la constancia de inicio del servicio.' }, { status: 500 })
  }
}
