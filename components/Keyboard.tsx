import { Flex } from "@chakra-ui/react";
import Key from "./Key"

interface KeyData {
  label?: string;
  w?: number;  // width multiplier
  h?: number;  // height multiplier
  a?: number;  // alignment, optional
  x?: number;  // x space
  y?: number;
}

interface KeyboardProps {
  layout: (string | KeyData)[][];
  highlightKey?: string;
}

export function Keyboard({ layout = [[]], highlightKey = ""} : KeyboardProps){
  return(
    <Flex direction="column">
      {layout.map((row, rowIndex) => {
        const keys = [];
        let nextWidth: number | undefined = undefined;
        let nextHeight: number | undefined = undefined;
        for (let i = 0; i < row.length; i++) {
          const item = row[i];
          // Handle blank key with "x"
          if (
            typeof item === "object" &&
            item !== null &&
            "x" in item
          ) {
            keys.push(
              <Key label = "" space = {true} width = {item.x} height={item.h ?? 1}/>
            );
            continue;
          }
          // Handle vertical space with "y"
          if (
            typeof item === "object" &&
            item !== null &&
            "y" in item
          ) {
            keys.push(
              <Key key={`blank-y-${i}`} label="" space={true} width={1} height={item.y} />
            );
            // End this row early and start a new row after this key
            break;
          }
          // Handle width-only or height-only object
          if (
            typeof item === "object" &&
            item !== null &&
            (Object.keys(item).length === 1 && ("w" in item || "h" in item))
          ) {
            if ("w" in item) nextWidth = item.w;
            if ("h" in item) nextHeight = item.h;
            continue;
          }
          // If item is a string, treat as label
          let label: string | undefined;
          let width: number | undefined;
          let height: number | undefined;
          if (typeof item === "string") {
            label = item;
            width = nextWidth;
            nextWidth = undefined;
            nextHeight = undefined;
          } else if (typeof item === "object" && item !== null) {
            label = item.label;
            width = item.w ?? nextWidth;
            nextWidth = undefined;
            nextHeight = undefined;
          }
          keys.push(
            <Key 
              key={i} 
              label={label} 
              width={width} 
              height={height} 
              highlight={highlightKey && highlightKey.toUpperCase() === label.toUpperCase()}
            />
          );
        }
        return (
          <Flex key={rowIndex} direction="row" justifyContent="flex-start">
            {keys}
          </Flex>
        );
      })}
    </Flex>
  );
}