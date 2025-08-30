import { Flex } from "@chakra-ui/react";
import Key from "./Key"

interface KeyData {
  label?: string;
  w?: number;  // width multiplier
  a?: number;  // alignment, optional
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
        for (let i = 0; i < row.length; i++) {
          const item = row[i];
          // If item is an object with only 'w', store width and skip rendering
          if (
            typeof item === "object" &&
            item !== null &&
            Object.keys(item).length === 1 &&
            "w" in item
          ) {
            nextWidth = item.w;
            continue;
          }
          // If item is a string, treat as label
          let label: string | undefined;
          let width: number | undefined;
          if (typeof item === "string") {
            label = item;
            width = nextWidth;
            nextWidth = undefined;
          } else if (typeof item === "object" && item !== null) {
            label = item.label;
            width = item.w ?? nextWidth;
            nextWidth = undefined;
          }
          keys.push(
            <Key key={i} label={label} width={width} />
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