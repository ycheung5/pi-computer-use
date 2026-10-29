using System;
using System.Drawing;
using System.Threading;
using System.Windows.Forms;

class CaptureForm : Form {
  protected override bool ShowWithoutActivation { get { return true; } }
}

class CaptureFixture {
  [STAThread]
  static void Main(string[] args) {
    Console.OutputEncoding = new System.Text.UTF8Encoding(false);
    CaptureForm target = new CaptureForm { Text = args[0], BackColor = Color.FromArgb(20,150,80), StartPosition = FormStartPosition.Manual, Left = 30, Top = 40, Width = 320, Height = 200 };
    if (args.Length > 1 && args[1] == "black") { target.FormBorderStyle = FormBorderStyle.None; target.BackColor = Color.Black; }
    CaptureForm cover = new CaptureForm { Text = args[0] + " cover", BackColor = Color.Magenta, StartPosition = FormStartPosition.Manual, Left = 30, Top = 40, Width = 320, Height = 200 };
    target.Shown += delegate { Console.WriteLine(target.Handle.ToInt64()); Console.Out.Flush(); };
    ThreadPool.QueueUserWorkItem(delegate {
      string command;
      while ((command = Console.ReadLine()) != null) {
        string captured = command;
        target.BeginInvoke((Action)delegate {
          if (captured == "cover") cover.Show();
          else if (captured == "minimize") target.WindowState = FormWindowState.Minimized;
          else if (captured == "hide") target.Hide();
          else if (captured == "stop") { cover.Dispose(); target.Close(); return; }
          Console.WriteLine("ok"); Console.Out.Flush();
        });
        if (captured == "stop") break;
      }
    });
    System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer { Interval = 60000 };
    timer.Tick += delegate { cover.Dispose(); target.Close(); };
    timer.Start(); Application.Run(target);
  }
}
