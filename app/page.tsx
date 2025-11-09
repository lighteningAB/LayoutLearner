"use client";

import React, { useState } from "react";
import { Keyboard } from "../components/Keyboard";
import { Heading, Flex, Button, Select } from "@chakra-ui/react";
import safeEval from "safe-eval";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Suspense } from "react";
import presets from "./presets/presets";
import AuthStatus from "../components/AuthStatus";
import AceEditor from "react-ace";
import { useJsonInput, useJsonInputActions } from "../components/json-context";

import "ace-builds/src-noconflict/mode-json";
import "ace-builds/src-noconflict/theme-textmate";

function KeyboardLayoutViewer() {

  const handleRender = () => {
    try {
      setLayout(safeEval(jsonInput));
    } catch {
      alert("Invalid JSON");
    }
  };

  const jsonInput = useJsonInput();
  const { setJsonInput } = useJsonInputActions() as {
    setJsonInput: React.Dispatch<React.SetStateAction<string>>;
  };

  const [layout, setLayout] = useState<any[][]>([]);

  const router = useRouter();

  const handleGoToPractice = () => {
    router.push(`/practice`);
  };

  useEffect(() => {
    try {
      setLayout(safeEval(jsonInput));
    }
    catch {
      //handle blank or errors
    }
  }, [jsonInput]);

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
        <Select width="10%" placeholder="Presets" onChange={handlePresetChange}>
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
