import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount: number, symbol: string = '$') {
  return `${symbol}${amount.toLocaleString()}`
}

export function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  let code = ''
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(bytes[i] % chars.length)
  }
  return code
}

export function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

export function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

export function calculatePayout(
  wagerAmount: number,
  totalWinnerPool: number,
  totalLoserPool: number
): number {
  if (totalWinnerPool === 0) return 0
  const share = wagerAmount / totalWinnerPool
  return wagerAmount + share * totalLoserPool
}
