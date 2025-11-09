"use client";
import React, { createContext, useContext, useState, useMemo } from "react"
import presets from "../app/presets/presets";

type jsonInputState = string

type Ctx = {
    jsonInput: jsonInputState;
    setJsonInput: React.Dispatch<React.SetStateAction<jsonInputState>>;
}

const JsonInputCtx = createContext<Ctx | null>(null);

export function JsonInputProvider({ children }: {children : React.ReactNode }) {
    const [jsonInput, setJsonInput] = useState<jsonInputState>((presets)[0] || "");
    const value = useMemo(() => ( { jsonInput, setJsonInput }), [jsonInput]);
    return <JsonInputCtx.Provider value={value}>{children}</JsonInputCtx.Provider>;
}

export function useJsonInput(){
    const ctx = useContext(JsonInputCtx);
    if (!ctx) throw new Error("useJsonInput must be used within jsonInputProvider");
        return ctx.jsonInput;
}

export function useJsonInputActions() {
    const ctx = useContext(JsonInputCtx);
    if (!ctx) throw new Error("useJsonInputActions must be used within jsonInputProvider");
    return { setJsonInput: ctx.setJsonInput}; 
}