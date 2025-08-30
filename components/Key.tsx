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
            <Box key={i} border='1px' height = {height*100} width = {width*100} padding = "10px" borderRadius="5px">
            {line}
            </Box>
        ))}
        </div>
    );
}

export default Key