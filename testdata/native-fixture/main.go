// Minimal native executable for protection tests.
// Prints SHIELD_OK and exits with 42.
package main

import (
	"fmt"
	"os"
)

func main() {
	fmt.Println("SHIELD_OK")
	os.Exit(42)
}
