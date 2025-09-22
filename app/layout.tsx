import { ReactNode } from "react";
import { ChakraProvider } from "@chakra-ui/react";
import SessionProviderWrapper from "./SessionProviderWrapper";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SessionProviderWrapper>
          <ChakraProvider>{children}</ChakraProvider>
        </SessionProviderWrapper>
      </body>
    </html>
  );
}
