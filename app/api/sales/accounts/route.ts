import { NextResponse } from 'next/server'

import { prisma } from '@/lib/db'
import { requirePermission } from '@/lib/permissions'
import { resolveBranchContext } from '@/lib/branches'

export async function GET(request: Request) {
  const access = await requirePermission(request, 'sales:write')
  if (access.response) return access.response

  const branchContext = await resolveBranchContext(request, access.session)
  if (!branchContext.branchId) return NextResponse.json([])

  const accounts = await prisma.cashAccount.findMany({
    where: { isActive: true, branchId: branchContext.branchId, custodianId: null },
    select: { id: true, name: true, type: true },
    orderBy: { name: 'asc' },
  })

  return NextResponse.json(accounts)
}
