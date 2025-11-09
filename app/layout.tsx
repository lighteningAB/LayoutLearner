import { ReactNode } from "react";
import { ChakraProvider } from "@chakra-ui/react";
import SessionProviderWrapper from "./SessionProviderWrapper";
import { JsonInputProvider } from "../components/json-context"

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SessionProviderWrapper>
          <ChakraProvider>
            <JsonInputProvider>
              {children}
            </JsonInputProvider>
          </ChakraProvider>
        </SessionProviderWrapper>
      </body>
    </html>
  );
}
