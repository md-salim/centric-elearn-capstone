import { HubConnectionBuilder, HubConnectionState } from '@microsoft/signalr'
import { useEffect, useRef, useState } from 'react'

export type BoardConnectionStatus = 'connecting' | 'live' | 'reconnecting'

export function useBoardHub(hotelId: number, onRoomUpdated: () => void): BoardConnectionStatus {
  const [status, setStatus] = useState<BoardConnectionStatus>('connecting')
  const onRoomUpdatedRef = useRef(onRoomUpdated)
  onRoomUpdatedRef.current = onRoomUpdated

  useEffect(() => {
    let disposed = false
    let retryTimer: number | undefined
    const connection = new HubConnectionBuilder()
      .withUrl('/hubs/board')
      .withAutomaticReconnect()
      .build()

    const scheduleRetry = () => {
      if (disposed || retryTimer !== undefined) return
      setStatus('reconnecting')
      retryTimer = window.setTimeout(() => {
        retryTimer = undefined
        void connect()
      }, 5000)
    }

    const connect = async () => {
      if (disposed || connection.state !== HubConnectionState.Disconnected) return
      try {
        await connection.start()
        await connection.invoke('JoinHotel', hotelId)
        if (!disposed) setStatus('live')
      } catch {
        if (!disposed) setStatus('reconnecting')
        if (connection.state !== HubConnectionState.Disconnected) {
          await connection.stop()
        }
        scheduleRetry()
      }
    }

    connection.on('room-updated', () => onRoomUpdatedRef.current())
    connection.onreconnecting(() => {
      if (!disposed) setStatus('reconnecting')
    })
    connection.onreconnected(async () => {
      try {
        await connection.invoke('JoinHotel', hotelId)
        if (!disposed) setStatus('live')
      } catch {
        if (!disposed) setStatus('reconnecting')
        await connection.stop()
      }
    })
    connection.onclose(scheduleRetry)
    void connect()

    return () => {
      disposed = true
      if (retryTimer !== undefined) window.clearTimeout(retryTimer)
      void connection.stop()
    }
  }, [hotelId])

  return status
}
