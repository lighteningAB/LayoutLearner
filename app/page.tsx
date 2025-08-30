"use client";

import { useState } from "react";
import { Keyboard } from "../components/Keyboard";
import { Heading, Textarea, Flex, Button } from "@chakra-ui/react";
import safeEval from "safe-eval";

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

  return (
    <div>
      <Heading >Keyboard Layout Viewer</Heading>
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