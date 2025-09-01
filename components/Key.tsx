import { Box } from "@chakra-ui/react"

interface KeyData{
    label: string;
    width?: number;
    height?: number;
    highlight?: boolean;
    space? : boolean;
}

export function Key({ label = "", width = 1, height = 1, highlight = false, space = false} : KeyData){
    return (
        <Box
            className={`key ${highlight ? "highlight" : ""}`}
            border={space ? undefined: '1px'}
            height={`${height*3}vw`}
            width={`${width*3}vw`}
            padding="10px"
            borderRadius="5px"
            fontSize="clamp(0.3vw, .8vw, 1.5vw)"
            overflow="hidden"
            background={highlight ? "yellow" : undefined}
            display="flex"
            alignItems="center"
            justifyContent="center"
            textAlign="center"
            whiteSpace="pre-line"
        >
            {label}
        </Box>
    );
}

export default Key