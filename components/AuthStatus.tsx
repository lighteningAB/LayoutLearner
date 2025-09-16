import { useSession, signIn, signOut } from "next-auth/react";
import { Button, HStack, Text} from "@chakra-ui/react";

export function AuthStatus() {
  const { data: session, status } = useSession();
  if (status === "loading") return <div>Loading...</div>;
  if (!session)
    return <Button onClick={() => signIn()}>Sign in</Button>;
  return (
    <HStack spacing={3} align="center">
      <Text fontSize="sm" color="gray.600" maxW="20vw" isTruncated>
        Signed in as {session.user?.email || session.user?.name}
      </Text>
      <Button onClick={() => signOut()}>
        Sign out
      </Button>
    </HStack>
  );
}

export default AuthStatus;