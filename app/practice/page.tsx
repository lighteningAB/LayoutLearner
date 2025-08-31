"use client";
import { useSearchParams } from "next/navigation";
import { useMemo } from "react";
import safeEval from "safe-eval";
import { Flex, Heading, Button } from "@chakra-ui/react";
import { Keyboard } from "../../components/Keyboard";
import { useRouter } from "next/navigation";
import LZString from "lz-string";

export default function PracticePage() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const layoutParam = searchParams.get("layout");
    const layout = useMemo(() => {
        if (!layoutParam) return null;
        try {
            const decoded = LZString.decompressFromEncodedURIComponent(layoutParam);
            return safeEval(decoded);
        } catch {
            return null;
        }
    }, [layoutParam]);


  const handleGoToLayout = () => {
    if (layoutParam) {
      router.push(`/?layout=${encodeURIComponent(layoutParam)}`);
    } else {
      router.push(`/`);
    }
  };

  return(
    <div>
        <Flex justifyContent = "space-between" direction="row" w = "80%" alignItems="center" mx="auto" paddingTop="5">
                <Heading>Keyboard Practice</Heading>
                
                <Button onClick={handleGoToLayout}>Go To Layout</Button>
        </Flex>
        <br />
        <Flex w = '100%' align="center" justify-content="center" direction="column">
                {layout.length > 0 && <Keyboard layout={layout} />}
        </Flex>
    </div>
  );
}