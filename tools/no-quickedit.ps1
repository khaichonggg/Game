# Turns off "QuickEdit" for this console window (called by start.bat).
# With QuickEdit on, clicking inside the black window starts a text selection and PAUSES the
# game server until Esc/Enter is pressed, so the game suddenly "cannot reach the server".
# Keep this file ASCII-only (Windows PowerShell 5.1 reads BOM-less files in the system code page).
$sig = @'
[DllImport("kernel32.dll", SetLastError = true)] public static extern IntPtr GetStdHandle(int nStdHandle);
[DllImport("kernel32.dll", SetLastError = true)] public static extern bool GetConsoleMode(IntPtr hConsoleHandle, out uint lpMode);
[DllImport("kernel32.dll", SetLastError = true)] public static extern bool SetConsoleMode(IntPtr hConsoleHandle, uint dwMode);
'@
try {
  $k = Add-Type -MemberDefinition $sig -Name 'BBConsoleMode' -Namespace 'BumperBrawl' -PassThru
  $h = $k::GetStdHandle(-10)  # STD_INPUT_HANDLE
  $mode = [uint32]0
  if ($k::GetConsoleMode($h, [ref]$mode)) {
    # clear ENABLE_QUICK_EDIT_MODE (0x40); ENABLE_EXTENDED_FLAGS (0x80) makes the change stick
    $new = ($mode -band (-bnot [uint32]0x40)) -bor [uint32]0x80
    [void]$k::SetConsoleMode($h, $new)
  }
} catch {
  # not a classic console (e.g. Windows Terminal) - nothing to do
}
exit 0
