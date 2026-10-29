using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.WindowsRuntime;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using Windows.Foundation;
using Windows.Graphics.Capture;
using Windows.Graphics.DirectX;
using Windows.Graphics.DirectX.Direct3D11;
using Windows.Graphics.Imaging;

// Isolated composited-frame fallback. It owns no UI and never sends input.
class WgcBridge {
  [ComImport, Guid("3628E81B-3CAC-4C60-B7F4-23CE0E0C3356"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface CaptureInterop {
    IntPtr CreateForWindow(IntPtr window, ref Guid iid);
    IntPtr CreateForMonitor(IntPtr monitor, ref Guid iid);
  }
  [ComImport, Guid("5B0D3235-4DBA-4D44-865E-8F1D0E4FD04D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface MemoryBytes { void GetBuffer(out IntPtr bytes, out uint capacity); }
  [StructLayout(LayoutKind.Sequential)] struct Rect { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr window);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr window);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr window, out Rect rect);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr window, int attribute, out Rect rect, int bytes);
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr context);
  [DllImport("d3d11.dll")] static extern int D3D11CreateDevice(IntPtr adapter, int driver, IntPtr software, uint flags, IntPtr levels, uint count, uint sdk, out IntPtr device, out int level, out IntPtr context);
  [DllImport("d3d11.dll")] static extern int CreateDirect3D11DeviceFromDXGIDevice(IntPtr device, out IntPtr inspectable);

  static Rectangle Bounds(IntPtr window) {
    Rect rect;
    if (DwmGetWindowAttribute(window, 9, out rect, 16) != 0 && !GetWindowRect(window, out rect)) throw new InvalidOperationException("WINDOW_BOUNDS_UNAVAILABLE");
    return Rectangle.FromLTRB(rect.Left, rect.Top, rect.Right, rect.Bottom);
  }

  static void Identity(IntPtr window, uint owner) {
    uint current; GetWindowThreadProcessId(window, out current);
    if (!IsWindow(window) || current != owner) throw new InvalidOperationException("WINDOW_IDENTITY_CHANGED");
    if (!IsWindowVisible(window) || IsIconic(window)) throw new InvalidOperationException("WGC_SURFACE_UNAVAILABLE: target is hidden or minimized");
  }

  static IDirect3DDevice Device() {
    IntPtr raw = IntPtr.Zero, context = IntPtr.Zero, dxgi = IntPtr.Zero, projected = IntPtr.Zero;
    try {
      int level;
      Marshal.ThrowExceptionForHR(D3D11CreateDevice(IntPtr.Zero, 1, IntPtr.Zero, 0x20, IntPtr.Zero, 0, 7, out raw, out level, out context));
      Guid iid = new Guid("54EC77FA-1377-44E6-8C32-88FD5F44C84C");
      Marshal.ThrowExceptionForHR(Marshal.QueryInterface(raw, ref iid, out dxgi));
      Marshal.ThrowExceptionForHR(CreateDirect3D11DeviceFromDXGIDevice(dxgi, out projected));
      return (IDirect3DDevice)Marshal.GetObjectForIUnknown(projected);
    } finally {
      foreach (IntPtr pointer in new IntPtr[] { projected, dxgi, context, raw }) if (pointer != IntPtr.Zero) Marshal.Release(pointer);
    }
  }

  static Bitmap CopyPixels(SoftwareBitmap software) {
    using (BitmapBuffer buffer = software.LockBuffer(BitmapBufferAccessMode.Read))
    using (IMemoryBufferReference reference = buffer.CreateReference()) {
      IntPtr source; uint capacity;
      ((MemoryBytes)reference).GetBuffer(out source, out capacity);
      BitmapPlaneDescription plane = buffer.GetPlaneDescription(0);
      int width = software.PixelWidth, height = software.PixelHeight, rowLength = checked(width * 4);
      if (width <= 0 || height <= 0 || (long)width * height > 40000000 || plane.StartIndex < 0 || plane.Stride < rowLength || (long)plane.StartIndex + (long)(height - 1) * plane.Stride + rowLength > capacity) throw new InvalidOperationException("WGC_INVALID_PIXEL_BUFFER");
      Bitmap bitmap = new Bitmap(width, height, PixelFormat.Format32bppArgb);
      BitmapData output = bitmap.LockBits(new Rectangle(0, 0, width, height), ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
      try {
        byte[] row = new byte[rowLength];
        for (int y = 0; y < height; y++) {
          Marshal.Copy(IntPtr.Add(source, checked(plane.StartIndex + y * plane.Stride)), row, 0, rowLength);
          Marshal.Copy(row, 0, IntPtr.Add(output.Scan0, y * output.Stride), rowLength);
        }
      } catch { bitmap.UnlockBits(output); bitmap.Dispose(); throw; }
      bitmap.UnlockBits(output); return bitmap;
    }
  }

  static object Capture(Dictionary<string, object> args) {
    IntPtr window = new IntPtr(Convert.ToInt64(args["nativeWindowHandle"]));
    uint owner = Convert.ToUInt32(args["processId"]);
    int maximum = Convert.ToInt32(args["maxWidth"]);
    Identity(window, owner);
    Rectangle bounds = Bounds(window);
    if (bounds.Width <= 0 || bounds.Height <= 0 || (long)bounds.Width * bounds.Height > 40000000) throw new InvalidOperationException("WGC_INVALID_BOUNDS");
    if (!GraphicsCaptureSession.IsSupported()) throw new InvalidOperationException("WGC_UNSUPPORTED");
    object factory = WindowsRuntimeMarshal.GetActivationFactory(typeof(GraphicsCaptureItem));
    Guid itemIid = new Guid("79C3F95B-31F7-4EC2-A464-632EF5D30760");
    IntPtr itemPointer = ((CaptureInterop)factory).CreateForWindow(window, ref itemIid);
    GraphicsCaptureItem item;
    try { item = (GraphicsCaptureItem)Marshal.GetObjectForIUnknown(itemPointer); }
    finally { Marshal.Release(itemPointer); }
    Stopwatch deadline = Stopwatch.StartNew();
    using (IDirect3DDevice device = Device())
    using (Direct3D11CaptureFramePool pool = Direct3D11CaptureFramePool.CreateFreeThreaded(device, DirectXPixelFormat.B8G8R8A8UIntNormalized, 1, item.Size))
    using (GraphicsCaptureSession session = pool.CreateCaptureSession(item)) {
      session.IsCursorCaptureEnabled = true;
      session.StartCapture();
      Direct3D11CaptureFrame frame = null;
      while (frame == null && deadline.ElapsedMilliseconds < 4000) { frame = pool.TryGetNextFrame(); if (frame == null) Thread.Sleep(20); }
      if (frame == null) throw new TimeoutException("WGC_FRAME_TIMEOUT");
      using (frame) {
        IAsyncOperation<SoftwareBitmap> copy = SoftwareBitmap.CreateCopyFromSurfaceAsync(frame.Surface, BitmapAlphaMode.Premultiplied);
        while (copy.Status == AsyncStatus.Started && deadline.ElapsedMilliseconds < 4000) Thread.Sleep(10);
        if (copy.Status == AsyncStatus.Started) { copy.Cancel(); throw new TimeoutException("WGC_COPY_TIMEOUT"); }
        if (copy.Status != AsyncStatus.Completed) throw new InvalidOperationException("WGC_COPY_FAILED: " + copy.Status);
        using (SoftwareBitmap software = copy.GetResults())
        using (Bitmap bitmap = CopyPixels(software)) {
          Identity(window, owner);
          if (Bounds(window) != bounds) throw new InvalidOperationException("WINDOW_MOVED_DURING_CAPTURE");
          Bitmap output = bitmap;
          try {
            if (maximum > 0 && bitmap.Width > maximum) {
              output = new Bitmap(maximum, Math.Max(1, (int)Math.Round((double)bitmap.Height * maximum / bitmap.Width)), PixelFormat.Format32bppArgb);
              using (Graphics graphics = Graphics.FromImage(output)) {
                graphics.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
                graphics.DrawImage(bitmap, new Rectangle(0, 0, output.Width, output.Height));
              }
            }
            byte[] png;
            using (MemoryStream memory = new MemoryStream()) { output.Save(memory, ImageFormat.Png); png = memory.ToArray(); }
            return new Dictionary<string, object> {
              { "ok", true }, { "action", "screenshot" }, { "screenshot", new Dictionary<string, object> {
                { "base64", Convert.ToBase64String(png) }, { "mimeType", "image/png" }, { "bytes", png.Length },
                { "width", output.Width }, { "height", output.Height }, { "method", "wgc" },
                { "bounds", new Dictionary<string, object> { { "x", bounds.X }, { "y", bounds.Y }, { "width", bounds.Width }, { "height", bounds.Height } } },
                { "origin", new Dictionary<string, object> { { "x", bounds.X }, { "y", bounds.Y } } },
                { "imageScale", (double)output.Width / bounds.Width }, { "imageScaleY", (double)output.Height / bounds.Height },
                { "occludedPossible", false }, { "windowCaptureFailed", false }, { "captureWarnings", new string[0] }
              } }
            };
          } finally { if (output != bitmap) output.Dispose(); }
        }
      }
    }
  }

  [MTAThread]
  static void Main() {
    Console.InputEncoding = new UTF8Encoding(false); Console.OutputEncoding = new UTF8Encoding(false);
    SetProcessDpiAwarenessContext(new IntPtr(-4));
    JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = 32 * 1024 * 1024 };
    string line;
    while ((line = Console.ReadLine()) != null) {
      try {
        Dictionary<string, object> request = json.Deserialize<Dictionary<string, object>>(line);
        if (request.ContainsKey("cancel")) continue;
        object result;
        try { result = Capture((Dictionary<string, object>)request["args"]); }
        catch (Exception error) { result = new Dictionary<string, object> { { "ok", false }, { "action", "screenshot" }, { "error", "WGC_CAPTURE_FAILED: " + error.Message } }; }
        Console.WriteLine(json.Serialize(new Dictionary<string, object> { { "id", request["id"] }, { "result", result } })); Console.Out.Flush();
      } catch (Exception error) { Console.Error.WriteLine("WGC_PROTOCOL_ERROR: " + error.Message); }
    }
  }
}
