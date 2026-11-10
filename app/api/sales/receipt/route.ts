import { NextResponse } from 'next/server'
import { z } from 'zod'

import { logAudit } from '@/lib/audit'
import { branchContextError, resolveBranchContext } from '@/lib/branches'
import { prisma, serializableTransaction } from '@/lib/db'
import { requirePermission } from '@/lib/permissions'

const receiptSchema = z.object({ saleId: z.string().min(1) })

export async function POST(request: Request) {
  const access = await requirePermission(request, 'sales:read')
  if (access.response) return access.response

  const branchContext = await resolveBranchContext(request, access.session)
  const branchError = branchContextError(branchContext)
  if (branchError) return branchError

  const payload = receiptSchema.safeParse(await request.json())
  if (!payload.success) {
    return NextResponse.json({ error: 'Selecciona una venta válida para imprimir.' }, { status: 400 })
  }

  try {
    const receipt = await serializableTransaction(async (transaction) => {
      const sale = await transaction.sale.findUnique({
        where: { id: payload.data.saleId },
        include: {
          customer: { select: { name: true, document: true } },
          branch: { select: { name: true, address: true, phone: true } },
          seller: { select: { name: true } },
          receivable: { select: { paidAmount: true, balance: true } },
          items: {
            include: {
              product: { select: { name: true, sku: true, type: true } },
            },
          },
        },
      })

      if (!sale || (!branchContext.isAll && sale.branchId !== branchContext.branchId)) {
        throw new Error('SALE_NOT_FOUND')
      }
      if (sale.status !== 'COMPLETED') throw new Error('SALE_NOT_COMPLETED')

      const claim = await transaction.sale.updateMany({
        where: { id: sale.id, originalPrintedAt: null, status: 'COMPLETED' },
        data: { originalPrintedAt: new Date() },
      })
      if (claim.count === 0 && sale.originalPrintedAt === null) {
        const latestSale = await transaction.sale.findUnique({
          where: { id: sale.id },
          select: { status: true, originalPrintedAt: true },
        })
        if (latestSale?.status !== 'COMPLETED') throw new Error('SALE_NOT_COMPLETED')
        if (!latestSale?.originalPrintedAt) throw new Error('RECEIPT_ORIGINAL_CLAIM_FAILED')
      }
      const isOriginal = claim.count === 1

      await logAudit({
        request,
        action: 'EXPORT',
        moduleName: 'Ventas',
        entity: 'SaleReceipt',
        entityId: sale.id,
        details: `${isOriginal ? 'Se emitió el original' : 'Se reimprimió una copia'} de la nota de venta ${sale.number}.`,
        newValue: { saleNumber: sale.number, copyType: isOriginal ? 'ORIGINAL' : 'COPY' },
      }, transaction)

      return {
        number: sale.number,
        createdAt: sale.createdAt.toISOString(),
        customerName: sale.customer?.name ?? 'Consumidor final',
        customerDocument: sale.customer?.document ?? '',
        branch: sale.branch,
        sellerName: sale.seller?.name ?? '',
        paymentMethod: sale.paymentMethod,
        paymentReference: sale.paymentReference,
        receivable: sale.receivable ? {
          paidAmount: sale.receivable.paidAmount.toString(),
          balance: sale.receivable.balance.toString(),
        } : null,
        notes: sale.notes ?? '',
        copyType: isOriginal ? 'ORIGINAL' : 'COPIA',
        subtotal: sale.subtotal.toString(),
        discountTotal: sale.discountTotal.toString(),
        taxAmount: sale.taxAmount.toString(),
        total: sale.total.toString(),
        items: sale.items.map((item) => ({
          name: item.product.name,
          sku: item.product.sku,
          type: item.product.type,
          quantity: item.quantity,
          unitPrice: item.unitPrice.toString(),
          discountPercent: item.discountPercent.toString(),
          lineTotal: item.lineTotal.toString(),
        })),
      }
    })

    return NextResponse.json(receipt)
  } catch (error) {
    console.error('ERROR_ISSUING_SALE_RECEIPT', error)
    if (error instanceof Error && error.message === 'SALE_NOT_FOUND') {
      return NextResponse.json({ error: 'La venta no existe o no pertenece a la sucursal seleccionada.' }, { status: 404 })
    }
    if (error instanceof Error && error.message === 'SALE_NOT_COMPLETED') {
      return NextResponse.json({ error: 'Solo se pueden emitir notas de ventas completadas.' }, { status: 400 })
    }
    return NextResponse.json({ error: 'No se pudo generar la nota de venta.' }, { status: 500 })
  }
}
