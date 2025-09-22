"use client";

import { useState } from "react";
import { Keyboard } from "../components/Keyboard";
import { Heading, Flex, Button, Select } from "@chakra-ui/react";
import safeEval from "safe-eval";
import { useRouter } from "next/navigation";
import LZString from "lz-string";
import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import presets from "./presets/presets";
import AuthStatus from "../components/AuthStatus";
import AceEditor from "react-ace";

import "ace-builds/src-noconflict/mode-json";
import "ace-builds/src-noconflict/theme-textmate";

function KeyboardLayoutViewer() {
  const [jsonInput, setJsonInput] = useState(Object.values(presets)[0] || "");
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

  const handlePresetChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const presetName = e.target.value;
    if (presetName && presets[presetName]) {
      setJsonInput(presets[presetName]);
    }
  };

  return (
    <div>
      <Flex
        justifyContent="space-between"
        direction="row"
        w="80%"
        alignItems="center"
        mx="auto"
        paddingTop="5"
      >
        <Heading>Keyboard Layout Viewer</Heading>
        <Flex direction="row" alignItems="center">
          <AuthStatus></AuthStatus>
          <Button onClick={handleGoToPractice} ml="0.5vw">
            Go To Practice
          </Button>
        </Flex>
      </Flex>
      <Flex w="80%" mx="auto" paddingTop="1vw" paddingBottom="1vw">
        <Select width="10%" onChange={handlePresetChange}>
          <option selected hidden disabled value="">
            Presets
          </option>
          {Object.keys(presets).map((label) => (
            <option key={label} value={label}>
              {label}
            </option>
          ))}
        </Select>
      </Flex>
      <Flex w="100%" align="center" justify-content="center" direction="column">
        <AceEditor
          mode="json"
          theme="textmate"
          value={jsonInput}
          onChange={setJsonInput}
          width="80%"
          height="15vh"
        />
        <br />
        <Button onClick={handleRender}>Render Keyboard</Button>
        <br />
        {layout.length > 0 && <Keyboard layout={layout} />}
      </Flex>
    </div>
  );
}

export default function Home() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <KeyboardLayoutViewer />
    </Suspense>
  );
}
