import { Box } from "@chakra-ui/react"

interface KeyData{
    label: string;
    width?: number;
    height?: number;
    highlight?: boolean;
}

export function Key({ label = "", width = 1, height = 1, highlight = false} : KeyData){
    return (
        <div
        className={`key ${highlight ? "highlight" : ""}`}
        >
        {label.split("<br>").map((line, i) => (
            <Box 
                key={i} 
                border='1px' 
                height = {`${height*5}vw`} 
                width = {`${width*5}vw`} 
                padding = "10px" 
                borderRadius="5px" 
                fontSize="clamp(0.3vw, .8vw, 1.5vw)"
                overflow="hidden">
            {line}
            </Box>
        ))}
        </div>
    );
}

export default Key