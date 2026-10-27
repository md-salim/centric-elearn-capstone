import { getJson } from './client'
import type { StaffUser } from './types'

export const listHousekeepers = (hotelId: number) =>
  getJson<StaffUser[]>('/api/users', { hotelId, role: 'Housekeeper' })
