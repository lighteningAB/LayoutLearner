import { Flex } from "@chakra-ui/react";
import React, { useState, useEffect } from "react";
import Key from "./Key";

interface KeyData {
  label?: string;
  w?: number; // width multiplier
  h?: number; // height multiplier
  a?: number; // alignment, optional
  x?: number; // x space
  y?: number;
  unitSize?: number;
}

interface KeyboardProps {
  layout: (string | KeyData)[][];
  highlightKey?: string;
}

export function Keyboard({ layout = [[]], highlightKey = "" }: KeyboardProps) {
  // Calculate largest row width and total height units (including y spacings)
  let totalHeightUnits = 0;
  const rowWidths = layout.map((row) => {
    let width = 0;
    let nextWidth: number | undefined = undefined;
    let maxHeight = 1;
    for (let i = 0; i < row.length; i++) {
      const item = row[i];
      if (typeof item === "object" && item !== null && "x" in item) {
        width += item.x;
        continue;
      }
      if (typeof item === "object" && item !== null && "w" in item) {
        nextWidth = item.w;
        continue;
      }
      if (typeof item === "object" && item !== null && "y" in item) {
        totalHeightUnits += item.y;
        continue;
      }
      let w = 1;
      let h = 1;
      if (typeof item === "string") {
        w = nextWidth ?? 1;
        nextWidth = undefined;
      } else if (typeof item === "object" && item !== null) {
        w = item.w ?? nextWidth ?? 1;
        h = item.h ?? 1;
        nextWidth = undefined;
      }
      width += w;
      if (h > maxHeight) maxHeight = h;
    }
    totalHeightUnits += maxHeight;
    return width;
  });
  const largestWidth = Math.max(...rowWidths);

  // Responsive unit size state
  const [unitSize, setUnitSize] = useState(() => {
    const containerWidthPx = window.innerWidth * 0.8;
    return containerWidthPx / largestWidth;
  });

  useEffect(() => {
    const calculateUnitSize = () => {
      const containerWidthPx = window.innerWidth * 0.8;
      setUnitSize(containerWidthPx / largestWidth);
    };
    // Recalculate on resize and layout/largestWidth changes
    window.addEventListener("resize", calculateUnitSize);
    calculateUnitSize(); // recalc on mount and whenever effect runs
    return () => window.removeEventListener("resize", calculateUnitSize);
  }, [layout, largestWidth]);

  // Render rows, pad with blank spaces if needed
  const rowMaxHeights: number[] = [];
  let renderedRows: React.ReactNode[] = [];
  layout.forEach((row, rowIndex) => {
    const keys = [];
    let nextWidth: number | undefined = undefined;
    let nextHeight: number | undefined = undefined;
    let maxHeight = 1;
    let rowWidth = 0;
    for (let i = 0; i < row.length; i++) {
      const item = row[i];
      let height: number | undefined;
      // Handle blank key with "x"
      if (typeof item === "object" && item !== null && "x" in item) {
        height = item.h ?? 1;
        keys.push(
          <Key
            label=""
            space={true}
            width={item.x}
            height={height}
            unitSize={unitSize}
            key={`x-${i}`}
          />
        );
        rowWidth += item.x;
        if (height > maxHeight) maxHeight = height;
        continue;
      }
      // Handle vertical space with "y"
      if (typeof item === "object" && item !== null && "y" in item) {
        // Treat as a new row with largest width
        renderedRows.push(
          <Key
            label=""
            space={true}
            width={largestWidth}
            height={item.y}
            unitSize={unitSize}
          />
        );
        continue;
      }
      // Handle width-only or height-only object
      if (
        typeof item === "object" &&
        item !== null &&
        Object.keys(item).length === 1 &&
        ("w" in item || "h" in item)
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
          unitSize={unitSize}
          highlight={
            highlightKey && highlightKey.toUpperCase() === label?.toUpperCase()
          }
        />
      );
      rowWidth += width ?? 1;
    }

    // Pad with blank spaces if rowWidth < largestWidth
    if (rowWidth < largestWidth) {
      keys.push(
        <Key
          key={`pad-${rowIndex}`}
          label=""
          space={true}
          width={largestWidth - rowWidth}
          height={1}
          unitSize={unitSize}
        />
      );
    }

    rowMaxHeights[rowIndex] = maxHeight;
    let marginTop = 0;
    if (rowIndex > 0 && rowMaxHeights[rowIndex - 1] > 1) {
      marginTop = -(rowMaxHeights[rowIndex - 1] - 1) * unitSize;
    }
    renderedRows.push(
      <Flex
        key={rowIndex}
        direction="row"
        justifyContent="flex-start"
        style={marginTop ? { marginTop: `${marginTop}px` } : undefined}
      >
        {keys}
      </Flex>
    );
  });

  // Set container height based on totalHeightUnits
  const containerHeightPx = totalHeightUnits * unitSize;

  return (
    <Flex
      direction="column"
      w="80vw"
      h={`${containerHeightPx}px`}
      justifyContent={"center"}
    >
      {renderedRows}
    </Flex>
  );
}
