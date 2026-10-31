using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Forms;

partial class WindowsBridge {
  [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr window, IntPtr dc, uint flags);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr window, int attribute, out Rect bounds, int bytes);

  static IntPtr ResolveCaptureWindow(Dictionary<string, object> args) {
    WindowReference bound=ResolveWindowReference(args);
    object value;
    long requested = bound!=null?bound.Window.ToInt64():args.TryGetValue("nativeWindowHandle", out value) ? Convert.ToInt64(value) : 0;
    uint process = args.TryGetValue("processId", out value) ? Convert.ToUInt32(value) : 0;
    string title = args.TryGetValue("windowTitle", out value) ? Convert.ToString(value) : null;
    if (requested != 0) {
      IntPtr handle = new IntPtr(requested);
      uint actual;
      GetWindowThreadProcessId(handle, out actual);
      if (!IsWindow(handle) || actual == 0 || (process != 0 && actual != process)) throw new InvalidOperationException("WINDOW_IDENTITY_CHANGED: refresh window observations");
      if (title != null) {
        System.Text.StringBuilder text = new System.Text.StringBuilder(2048);
        GetWindowText(handle, text, text.Capacity);
        if (text.ToString().IndexOf(title, StringComparison.OrdinalIgnoreCase) < 0) throw new InvalidOperationException("WINDOW_TARGET_MISMATCH");
      }
      return handle;
    }
    if (process == 0 && title == null) {
      IntPtr foreground = GetForegroundWindow();
      if (foreground == IntPtr.Zero) throw new InvalidOperationException("WINDOW_NOT_FOUND: no foreground window");
      return foreground;
    }
    List<IntPtr> matches = new List<IntPtr>();
    EnumWindows(delegate(IntPtr handle, IntPtr unused) {
      uint actual;
      GetWindowThreadProcessId(handle, out actual);
      if (!IsWindowVisible(handle) || (process != 0 && actual != process)) return true;
      System.Text.StringBuilder text = new System.Text.StringBuilder(2048);
      GetWindowText(handle, text, text.Capacity);
      if (title == null || text.ToString().IndexOf(title, StringComparison.OrdinalIgnoreCase) >= 0) matches.Add(handle);
      return true;
    }, IntPtr.Zero);
    if (matches.Count == 0) throw new InvalidOperationException("WINDOW_NOT_FOUND");
    if (matches.Count > 1) throw new InvalidOperationException("WINDOW_TARGET_AMBIGUOUS: use nativeWindowHandle and processId");
    return matches[0];
  }

  static Rectangle WindowCaptureBounds(IntPtr window) {
    Rect bounds;
    if (DwmGetWindowAttribute(window, 9, out bounds, Marshal.SizeOf(typeof(Rect))) != 0 || bounds.Right <= bounds.Left || bounds.Bottom <= bounds.Top) {
      if (!GetWindowRect(window, out bounds)) throw new InvalidOperationException("WINDOW_BOUNDS_UNAVAILABLE");
    }
    return Rectangle.FromLTRB(bounds.Left, bounds.Top, bounds.Right, bounds.Bottom);
  }

  static bool ClearCaptureRegion(IntPtr window, Rectangle bounds, Rectangle desktop) {
    if (GetForegroundWindow() != window || !IsWindowVisible(window) || IsIconic(window) || !desktop.Contains(bounds)) return false;
    bool found = false, clear = true;
    EnumWindows(delegate(IntPtr other, IntPtr unused) {
      if (other == window) { found = true; return false; }
      if (!IsWindowVisible(other) || IsIconic(other)) return true;
      Rect box;
      if (!GetWindowRect(other, out box)) { clear = false; return false; }
      if (Rectangle.FromLTRB(box.Left, box.Top, box.Right, box.Bottom).IntersectsWith(bounds)) { clear = false; return false; }
      return true;
    }, IntPtr.Zero);
    return found && clear;
  }

  static Bitmap CopyCaptureRegion(Rectangle bounds) {
    if (bounds.Width <= 0 || bounds.Height <= 0 || (long)bounds.Width * bounds.Height > 40000000) throw new InvalidOperationException("CAPTURE_BOUNDS_UNAVAILABLE: region is empty or exceeds 40 million pixels");
    Bitmap image = new Bitmap(bounds.Width, bounds.Height, PixelFormat.Format32bppArgb);
    try {
      using (Graphics graphics = Graphics.FromImage(image)) graphics.CopyFromScreen(bounds.Location, Point.Empty, bounds.Size);
      return image;
    } catch { image.Dispose(); throw; }
  }

  static bool CaptureIsBlank(Bitmap image) {
    for (int y = 0; y < image.Height; y += Math.Max(1, image.Height / 32)) {
      for (int x = 0; x < image.Width; x += Math.Max(1, image.Width / 32)) {
        Color color = image.GetPixel(x, y);
        if (color.R > 10 || color.G > 10 || color.B > 10) return false;
      }
    }
    return true;
  }

  static Bitmap PrintCapture(IntPtr window, Rectangle wanted) {
    Rect windowBox;
    if (!GetWindowRect(window, out windowBox)) return null;
    Rectangle full = Rectangle.FromLTRB(windowBox.Left, windowBox.Top, windowBox.Right, windowBox.Bottom);
    if (full.Width <= 0 || full.Height <= 0 || (long)full.Width * full.Height > 40000000 || !full.Contains(wanted)) return null;
    using (Bitmap entire = new Bitmap(full.Width, full.Height, PixelFormat.Format32bppArgb)) {
      bool rendered;
      using (Graphics graphics = Graphics.FromImage(entire)) {
        IntPtr dc = graphics.GetHdc();
        try { rendered = PrintWindow(window, dc, 2); }
        finally { graphics.ReleaseHdc(dc); }
      }
      if (!rendered) return null;
      Bitmap cropped = entire.Clone(new Rectangle(wanted.X - full.X, wanted.Y - full.Y, wanted.Width, wanted.Height), PixelFormat.Format32bppArgb);
      if (CaptureIsBlank(cropped)) { cropped.Dispose(); return null; }
      return cropped;
    }
  }

  static object CaptureScreenshot(Dictionary<string, object> args) {
    if(args.ContainsKey("windowRef") && TextOption(args,"scope","active_window")=="desktop")throw new InvalidOperationException("WINDOW_REFERENCE_CONFLICT: desktop capture cannot use a window reference");
    bool desktopScope = Convert.ToString(args["scope"]) == "desktop";
    int maximum = Convert.ToInt32(args["maxWidth"]);
    Rectangle desktop = SystemInformation.VirtualScreen;
    Rectangle bounds = desktop;
    Bitmap image = null;
    string method = "screen";
    bool occluded = false, failed = false;
    List<string> warnings = new List<string>();
    IntPtr target = IntPtr.Zero;
    uint owner = 0;
    var referenceMetadata=new Dictionary<string,object>();
    try {
    if (!desktopScope) {
      target = ResolveCaptureWindow(args);
      WindowReference binding=ObserveWindowReference(target,referenceMetadata);if(binding!=null){currentReference=binding;referenceMetadata["windowRef"]=binding.Id;}
      GetWindowThreadProcessId(target, out owner);CheckWindowReference(target);
      object requestedActivation;
      if (args.TryGetValue("activate", out requestedActivation) && Convert.ToBoolean(requestedActivation)){BeginWindowDispatch();if(!SetForegroundWindow(target))warnings.Add("WINDOW_ACTIVATION_REFUSED: Windows did not bring the target to foreground");}
      bounds = WindowCaptureBounds(target);
      if (!IsIconic(target) && IsWindowVisible(target) && bounds.Width > 0 && bounds.Height > 0) {
        if (ClearCaptureRegion(target, bounds, desktop)) {
          Bitmap candidate = null;
          try {
            candidate = CopyCaptureRegion(bounds);
            if (WindowCaptureBounds(target) == bounds && ClearCaptureRegion(target, bounds, desktop)) { image = candidate; candidate = null; method = "screen-region"; }
          } catch (Exception error) { warnings.Add("SCREEN_REGION_RETRY: " + error.Message); }
          finally { if (candidate != null) candidate.Dispose(); }
        }
        if (image == null) { image = PrintCapture(target, bounds); method = "printwindow"; }
        if (image == null) {
          warnings.Add("PRINTWINDOW_FAILED_OR_BLANK");
          Rectangle visible = Rectangle.Intersect(bounds, desktop);
          if (visible.Width > 0 && visible.Height > 0) {
            bounds = visible; image = CopyCaptureRegion(bounds); method = "screen-region"; occluded = true;
          }
        }
      }
      if (image == null) {
        failed = true; bounds = desktop; method = "screen";
        warnings.Add("WINDOW_CAPTURE_FAILED: returning desktop pixels instead of the unavailable target surface");
      }
    }
      if (image == null) image = CopyCaptureRegion(bounds);
      if (target != IntPtr.Zero) {
        CheckWindowReference(target);
        uint ownerAfter;
        GetWindowThreadProcessId(target, out ownerAfter);
        if (!IsWindow(target) || owner != ownerAfter) throw new InvalidOperationException("WINDOW_IDENTITY_CHANGED_DURING_CAPTURE");
        if (!failed && WindowCaptureBounds(target) != bounds && !occluded) throw new InvalidOperationException("WINDOW_MOVED_DURING_CAPTURE: observe the target again");
      }
      if (maximum > 0 && image.Width > maximum) {
        int height = Math.Max(1, (int)Math.Round((double)image.Height * maximum / image.Width));
        Bitmap resized = new Bitmap(maximum, height, PixelFormat.Format32bppArgb);
        using (Graphics graphics = Graphics.FromImage(resized)) {
          graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
          graphics.DrawImage(image, new Rectangle(0, 0, resized.Width, resized.Height));
        }
        image.Dispose(); image = resized;
      }
      byte[] png;
      using (MemoryStream bytes = new MemoryStream()) { image.Save(bytes, ImageFormat.Png); png = bytes.ToArray(); }
      Dictionary<string, object> metadata = new Dictionary<string, object> {
        { "mimeType", "image/png" }, { "base64", Convert.ToBase64String(png) }, { "bytes", png.Length },
        { "width", image.Width }, { "height", image.Height }, { "method", method },
        { "bounds", new Dictionary<string, object> { { "x", bounds.X }, { "y", bounds.Y }, { "width", bounds.Width }, { "height", bounds.Height } } },
        { "origin", new Dictionary<string, object> { { "x", bounds.X }, { "y", bounds.Y } } },
        { "imageScale", (double)image.Width / bounds.Width },
        { "imageScaleY", (double)image.Height / bounds.Height },
        { "occludedPossible", occluded }, { "windowCaptureFailed", failed }, { "captureWarnings", warnings }
      };
      Dictionary<string, object> result = Result(true, "screenshot");
      metadata["source"]=desktopScope?"desktop":"window";
      foreach(var pair in referenceMetadata){result[pair.Key]=pair.Value;metadata[pair.Key]=pair.Value;}
      result["screenshot"] = metadata;
      if(target!=IntPtr.Zero && !failed){RememberPointerOrigin(target);RememberPointerTitle(args,target);}
      if (target != IntPtr.Zero && !failed && occluded) result["wgcTarget"] = new Dictionary<string, object> { { "nativeWindowHandle", target.ToInt64() }, { "processId", owner }, {"_windowMarker",WindowReferenceDescriptor(target)} };
      return result;
    } finally { if (image != null) image.Dispose(); }
  }
}
