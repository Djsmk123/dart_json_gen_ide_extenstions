# VS Code Extension - Custom Extension Support

## Update v1.0.0

The VS Code extension now supports reading the `dart_json_gen.yaml` configuration file to detect custom file extensions!

### What's New

- **Automatic Config Detection**: The extension now reads `dart_json_gen.yaml` or `dart_json_gen.yml` from your workspace root
- **Custom Extension Support**: Works with any custom extension you configure (`.t.dart`, `.g.dart`, `.generated.dart`, etc.)
- **Smart Cleanup**: The clean command now respects your configured extension

### How It Works

1. **Configuration File**: Place a `dart_json_gen.yaml` file in your workspace root:
   ```yaml
   generated_extension: ".t.dart"
   ```

2. **Generate Code**: Use the extension commands as usual:
   - Right-click on a Dart file → "Generate JSON Code"
   - Right-click on a folder → "Generate JSON Code for Folder"

3. **Clean Files**: The clean command will now delete files with your configured extension:
   - Right-click → "Clean Generated Files"

### Example

**Configuration (`dart_json_gen.yaml`):**
```yaml
generated_extension: ".t.dart"
```

**Generated Files:**
- `user.t.dart` (instead of `user.gen.dart`)
- `product.t.dart`
- `chat_event.t.dart`

### Verbose Output

Enable verbose output in VS Code settings to see which extension is being used:

```json
{
  "dartJsonGen.verboseOutput": true
}
```

Output will show:
```
Using extension: .t.dart
```

### Installation

1. Install the updated extension:
   ```bash
   code --install-extension dart-json-gen-1.0.0.vsix
   ```

2. Or manually:
   - Open VS Code
   - Go to Extensions (Cmd+Shift+X)
   - Click the "..." menu → "Install from VSIX..."
   - Select `dart-json-gen-1.0.0.vsix`

### Compatibility

- Works with all existing features
- Backward compatible (defaults to `.gen.dart` if no config file found)
- Supports both `.yaml` and `.yml` config file extensions

### Technical Details

The extension uses a simple YAML parser to read the `generated_extension` field from the configuration file. If no configuration file is found, it defaults to `.gen.dart` for backward compatibility.

**Config Resolution Order:**
1. `dart_json_gen.yaml` in workspace root
2. `dart_json_gen.yml` in workspace root
3. Default: `.gen.dart`
