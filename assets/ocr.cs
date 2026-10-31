using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using Windows.Graphics.Imaging;
using Windows.Media.Ocr;

[ComImport, Guid("5B0D3235-4DBA-4D44-865E-8F1D0E4FD04D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface OcrBufferBytes { void GetBuffer(out IntPtr data, out uint capacity); }

// OCR has its own process so stalled WinRT recognition cannot block UIA or stopping.
class OcrBridge {
  static Dictionary<string,object> Recognize(Dictionary<string,object> args) {
    OcrEngine engine=OcrEngine.TryCreateFromUserProfileLanguages();
    if(engine==null) throw new InvalidOperationException("OCR_LANGUAGE_UNAVAILABLE: no OCR engine for user profile languages; install a supported Windows language capability");
    List<string> languages=new List<string>();
    foreach(var language in OcrEngine.AvailableRecognizerLanguages) languages.Add(language.LanguageTag);
    byte[] png=Convert.FromBase64String(Convert.ToString(args["png"]));
    if(png.Length>24*1024*1024) throw new InvalidOperationException("OCR_IMAGE_TOO_LARGE: encoded image exceeds 24 MiB");
    using(MemoryStream stream=new MemoryStream(png)) using(Bitmap loaded=new Bitmap(stream)) {
      if(loaded.Width>OcrEngine.MaxImageDimension || loaded.Height>OcrEngine.MaxImageDimension) throw new InvalidOperationException("OCR_IMAGE_TOO_LARGE: image exceeds OcrEngine.MaxImageDimension");
      using(Bitmap source=new Bitmap(loaded.Width,loaded.Height,PixelFormat.Format32bppArgb)) {
        using(Graphics draw=Graphics.FromImage(source)) { draw.Clear(Color.White); draw.DrawImageUnscaled(loaded,0,0); }
        using(SoftwareBitmap image=new SoftwareBitmap(BitmapPixelFormat.Bgra8,source.Width,source.Height,BitmapAlphaMode.Ignore)) {
          BitmapData pixels=source.LockBits(new Rectangle(0,0,source.Width,source.Height),ImageLockMode.ReadOnly,PixelFormat.Format32bppArgb);
          try {
            using(BitmapBuffer buffer=image.LockBuffer(BitmapBufferAccessMode.Write)) using(var reference=buffer.CreateReference()) {
              IntPtr destination; uint capacity; ((OcrBufferBytes)reference).GetBuffer(out destination,out capacity);
              BitmapPlaneDescription plane=buffer.GetPlaneDescription(0);
              byte[] row=new byte[source.Width*4];
              for(int y=0;y<source.Height;y++) {
                long target=(long)plane.StartIndex+(long)plane.Stride*y;
                if(target<0 || target+row.Length>capacity) throw new InvalidOperationException("OCR_BUFFER_BOUNDS");
                Marshal.Copy(IntPtr.Add(pixels.Scan0,pixels.Stride*y),row,0,row.Length);
                Marshal.Copy(row,0,IntPtr.Add(destination,(int)target),row.Length);
              }
            }
          } finally { source.UnlockBits(pixels); }
          var operation=engine.RecognizeAsync(image);
          Stopwatch watch=Stopwatch.StartNew();
          try {
            while(operation.Status==Windows.Foundation.AsyncStatus.Started) {
              if(watch.ElapsedMilliseconds>10000) { operation.Cancel(); throw new InvalidOperationException("OCR_TIMEOUT: recognition exceeded 10 seconds"); }
              Thread.Sleep(10);
            }
            if(operation.Status==Windows.Foundation.AsyncStatus.Canceled) throw new InvalidOperationException("OCR_CANCELLED");
            if(operation.Status==Windows.Foundation.AsyncStatus.Error) throw new InvalidOperationException("OCR_RECOGNITION_FAILED: "+operation.ErrorCode);
            OcrResult result=operation.GetResults();
            List<object> lines=new List<object>();
            foreach(OcrLine line in result.Lines) {
              List<object> words=new List<object>();
              foreach(OcrWord word in line.Words) {
                var box=word.BoundingRect;
                words.Add(new Dictionary<string,object>{{"text",word.Text},{"x",box.X},{"y",box.Y},{"width",box.Width},{"height",box.Height}});
              }
              lines.Add(new Dictionary<string,object>{{"text",line.Text},{"words",words}});
            }
            return new Dictionary<string,object>{{"ok",true},{"action","recognize"},{"text",result.Text},{"lines",lines},{"language",engine.RecognizerLanguage.LanguageTag},{"availableLanguages",languages}};
          } finally { operation.Close(); }
        }
      }
    }
  }
  [MTAThread] static void Main() {
    Console.InputEncoding=new UTF8Encoding(false); Console.OutputEncoding=new UTF8Encoding(false);
    JavaScriptSerializer json=new JavaScriptSerializer { MaxJsonLength=32*1024*1024 };
    string line;
    while((line=Console.ReadLine())!=null) {
      Dictionary<string,object> request=null;
      try {
        request=json.Deserialize<Dictionary<string,object>>(line);
        if(request.ContainsKey("cancel")) continue;
        Dictionary<string,object> result;
        try { result=Recognize((Dictionary<string,object>)request["args"]); }
        catch(Exception error) { result=new Dictionary<string,object>{{"ok",false},{"action","recognize"},{"error","OCR_UNAVAILABLE: "+error.Message}}; }
        Console.WriteLine(json.Serialize(new Dictionary<string,object>{{"id",request["id"]},{"result",result}})); Console.Out.Flush();
      } catch(Exception error) { Console.Error.WriteLine("OCR_PROTOCOL_ERROR: "+error.Message); }
    }
  }
}
