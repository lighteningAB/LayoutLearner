import { useSession, signIn, signOut } from "next-auth/react";
import { Button, Flex, Text } from "@chakra-ui/react";

export function AuthStatus() {
  const { data: session, status } = useSession();
  if (status === "loading") return <div>Loading...</div>;
  if (!session)
    return <Button onClick={() => signIn()}>Sign in</Button>;
  return (
    <Flex direction="row">
      <Text fontSize="sm" color="gray.600" maxW="20vw" isTruncated>
        Signed in as {session.user?.email || session.user?.name}
      </Text>
      <Button onClick={() => signOut()} ml = "0.5vw">Sign out</Button>
    </Flex>
  );
}

export default AuthStatus;