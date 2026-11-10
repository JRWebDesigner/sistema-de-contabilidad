import { NextResponse } from 'next/server'

import { requireAnyPermission, rolePermissions } from '@/lib/permissions'
import { resolveBranchContext } from '@/lib/branches'
import { prisma } from '@/lib/db'

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(request: Request, { params }: RouteContext) {
  const access = await requireAnyPermission(request, ['sales:read', 'inventory:read', 'finance:read', 'contacts:read'])
  if (access.response) return access.response

  const { id } = await params
  const report = await prisma.archivedReport.findUnique({
    where: { id },
    select: { id: true, title: true, type: true, fileName: true, content: true, branchId: true },
  })
  if (!report) return NextResponse.json({ error: 'No se encontró el documento.' }, { status: 404 })

  const permissions = rolePermissions(access.session.role)
  const requiredPermission = report.type === 'SALES_REPORT'
    ? 'sales:read'
    : report.type === 'INVENTORY_REPORT'
      ? 'inventory:read'
      : report.type === 'CONTACTS_REPORT'
        ? 'contacts:read'
        : 'finance:read'
  const hasPermission = permissions.includes(requiredPermission)
  if (!hasPermission) return NextResponse.json({ error: 'No tienes permiso para consultar este documento.' }, { status: 403 })

  const branchContext = await resolveBranchContext(request, access.session)
  if (!branchContext.isAll && (!branchContext.branchId || report.branchId !== branchContext.branchId)) {
    return NextResponse.json({ error: 'No tienes permiso para consultar documentos de otra sucursal.' }, { status: 403 })
  }

  const fileName = encodeURIComponent(report.fileName)
  const disposition = new URL(request.url).searchParams.get('download') === '1' ? 'attachment' : 'inline'
  return new Response(new Uint8Array(report.content), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${disposition}; filename*=UTF-8''${fileName}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
