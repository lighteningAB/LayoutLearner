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
  const rowMaxHeights: number[] = [];

  return(
    <Flex direction="column">
      {layout.map((row, rowIndex) => {
        const keys = [];
        let nextWidth: number | undefined = undefined;
        let nextHeight: number | undefined = undefined;
        let maxHeight = 1;
        for (let i = 0; i < row.length; i++) {
          const item = row[i];
          let height: number | undefined;
           // Handle blank key with "x"
          if (
            typeof item === "object" &&
            item !== null &&
            "x" in item
          ) {
            height = item.h ?? 1;
            keys.push(
              <Key label = "" space = {true} width = {item.x} height={height}/>
            );
            if (height > maxHeight) maxHeight = height;
            continue;
          }
          // Handle vertical space with "y"
          if (
            typeof item === "object" &&
            item !== null &&
            "y" in item
          ) {
            height = item.y;
            keys.push(
              <Key key={`blank-y-${i}`} label="" space={true} width={1} height={height} />
            );
            if (height > maxHeight) maxHeight = height;
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
          if (typeof item === "string") {
            label = item;
            width = nextWidth;
            height = nextHeight;
            nextWidth = undefined;
            nextHeight = undefined;
          } else if (typeof item === "object" && item !== null) {
            label = item.label;
            width = item.w ?? nextWidth;
            height = item.h ?? nextHeight;
            nextWidth = undefined;
            nextHeight = undefined;
          }
          if (height && height > maxHeight) maxHeight = height;
          keys.push(
            <Key 
              key={i} 
              label={label} 
              width={width} 
              height={height} 
              highlight={highlightKey && highlightKey.toUpperCase() === label?.toUpperCase()}
            />
          );
        }

        rowMaxHeights[rowIndex] = maxHeight;

        let marginTop = 0;
        if (rowIndex > 0 && rowMaxHeights[rowIndex - 1] > 1) {
          marginTop = -(rowMaxHeights[rowIndex - 1] - 1) * 3;
        }

        return (
          <Flex key={rowIndex} direction="row" justifyContent="flex-start" style={marginTop ? { marginTop: `${marginTop}vw` } : undefined}>
            {keys}
          </Flex>
        );
      })}
    </Flex>
  );
}