import { createContext, useContext } from 'react'

export const CallContext = createContext({ startCall: async () => {}, busy: false })
export const useCalls = () => useContext(CallContext)
