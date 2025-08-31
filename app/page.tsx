"use client";

import { useState } from "react";
import { Keyboard } from "../components/Keyboard";
import { Heading, Textarea, Flex, Button } from "@chakra-ui/react";
import safeEval from "safe-eval";
import { useRouter } from "next/navigation"
import LZString from "lz-string";
import { useEffect } from "react";
import { useSearchParams } from "next/navigation";

export default function Home() {
  const [jsonInput, setJsonInput] = useState(
    `[["Esc","Q","W","E","R","T","Y","U","I","O","P","Backspace"],
  [{w:1.25},"Tab","A","S","D","F","G","H","J","K","L",{w:1.75},"Enter"],
  [{w:1.75},"Shift","Z","X","C","V","B","N","M","<",{w:1.25},"Shift","Fn"],
  [{w:1.25},"Hyper","Super","Meta",{w:6.25}," ",{w:1.25},"Meta",{w:1.25},"Super"]]`
  );
  const [layout, setLayout] = useState<any[][]>([]);

  const handleRender = () => {
    try {
      const parsed = safeEval(jsonInput);
      setLayout(parsed);
    } catch {
      alert("Invalid JSON");
    }
  };

  const router = useRouter();

  const handleGoToPractice = () => {
    const compressed = LZString.compressToEncodedURIComponent(jsonInput);
    router.push(`/practice?layout=${compressed}`);
  };

  const searchParams = useSearchParams();

  useEffect(() => {
    const layoutParam = searchParams.get("layout");
    if (layoutParam) {
      try {
        const decoded = LZString.decompressFromEncodedURIComponent(layoutParam);
        setJsonInput(decoded);
        setLayout(safeEval(decoded));
      } catch {
        // handle error
      }
    }
  }, [searchParams]);

  return (
    <div>
      <Flex justifyContent = "space-between" direction="row" w = "80%" alignItems="center" mx="auto" paddingTop="5">
        <Heading>Keyboard Layout Viewer</Heading>
        
        <Button onClick={handleGoToPractice}>Go To Practice</Button>
      </Flex>
      <br />
      <Flex w = '100%' align="center" justify-content="center" direction="column">
        <Textarea
          value={jsonInput}
          onChange={(e) => setJsonInput(e.target.value)}
          rows={10}
          cols={40}
          width={'80%'}
        />
        <br />
        <Button onClick={handleRender}>Render Keyboard</Button>
        <br />
        {layout.length > 0 && <Keyboard layout={layout} />}
      </Flex>

    </div>
  );
}