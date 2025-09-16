"use client";
import { useSearchParams } from "next/navigation";
import { useMemo } from "react";
import safeEval from "safe-eval";
import { Flex, Heading, Button, Alert, AlertIcon } from "@chakra-ui/react";
import { Keyboard } from "../../components/Keyboard";
import { useRouter } from "next/navigation";
import LZString from "lz-string";
import { useState, useEffect } from "react"; 
import { Suspense } from "react";

function PracticePage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const layoutParam = searchParams.get("layout");
  const layout = useMemo(() => {
      if (!layoutParam) return null;
      try {
          const decoded = LZString.decompressFromEncodedURIComponent(layoutParam);
          return safeEval(decoded);
      } catch {
          return null;
      }
  }, [layoutParam]);

  const [targetKey, setTargetKey] = useState("")
  const [pressedKey, setPressedKey] = useState("");
  const [showCorrect, setShowCorrect] = useState(false);

  // Set a random targetKey when layout is loaded
  useEffect(() => {
    if (layout && layout.length > 0) {
      pickRandomKey();
    }
  }, [layout]);

  const getLegends = (key: string) => key.split("\n").map(s => s.trim()).filter(Boolean);

  const pickRandomKey = (excludeKey?: string) => {
    if (layout && layout.length > 0) {
      const allKeys = layout.flat().filter(k => typeof k === "string" && k !== excludeKey);
      if (allKeys.length > 0) {
        const randomKey = allKeys[Math.floor(Math.random() * allKeys.length)];
        setTargetKey(randomKey);
      }
    }
  };

  const handleSkip = () => {
    pickRandomKey(targetKey);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Meta") {
        e.preventDefault(); // Suppress default Meta key behavior
        return;
      }
      setPressedKey(e.key);

      const legends = targetKey ? getLegends(targetKey) : [];
      const pressed = e.key.toUpperCase();

      if (legends.some(l => l.toUpperCase() === pressed)) {
      setShowCorrect(true);
      setTimeout(() => setShowCorrect(false), 1000);
      pickRandomKey(targetKey);
    }
    // Special case for ESC
    if (pressed === "ESCAPE" && legends.some(l => l.toUpperCase() === "ESC")) {
      setShowCorrect(true);
      setTimeout(() => setShowCorrect(false), 1000);
      pickRandomKey(targetKey);
    }
    if (pressed === "CAPSLOCK" && legends.some(l => l.toUpperCase() === "CAPS LOCK")) {
      setShowCorrect(true);
      setTimeout(() => setShowCorrect(false), 1000);
      pickRandomKey(targetKey);
    }
  };
  window.addEventListener("keydown", handleKeyDown);
  return () => window.removeEventListener("keydown", handleKeyDown);
}, [targetKey, layout]);
  
  const handleGoToLayout = () => {
    if (layoutParam) {
      router.push(`/?layout=${encodeURIComponent(layoutParam)}`);
    } else {
      router.push(`/`);
    }
  };

  console.log(pressedKey)
  
  return(
      <div>
          <Flex justifyContent = "space-between" direction="row" w = "80%" alignItems="center" mx="auto" paddingTop="5">
            <Heading>Keyboard Practice</Heading>
            <Button onClick={handleGoToLayout}>Go To Layout</Button>
          </Flex>
          <br />
          <Flex w = '100%' align="center" justify-content="center" direction="column">
            {layout.length > 0 && <Keyboard layout={layout} highlightKey={targetKey}/>}
            {targetKey && <Heading size="md">Press: {targetKey}</Heading>}
            {pressedKey && <div>Last pressed: {pressedKey}</div>}
            <Button mt={4} colorScheme="yellow" onClick={handleSkip}>
              Skip Key
            </Button>
            {showCorrect && (
              <Alert status="success" mt={4} borderRadius="md" width="auto">
                <AlertIcon />
                Correct!
              </Alert>
            )}
          </Flex>
      </div>
  );
}

export default function Home() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <PracticePage />
    </Suspense>
  );
}