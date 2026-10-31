using System;
using System.Threading;
using System.Windows.Forms;

class PassiveForm : Form {
  protected override bool ShowWithoutActivation { get { return true; } }
}

class Fixture {
  [STAThread]
  static void Main(string[] args) {
    Console.OutputEncoding = new System.Text.UTF8Encoding(false);
    string title = args[0];
    PassiveForm visible = new PassiveForm { Text = title, Width = 220, Height = 120 };
    PassiveForm hidden = new PassiveForm { Text = title + " hidden", Width = 120, Height = 80 };
    IntPtr hiddenHandle = hidden.Handle;
    visible.Shown += delegate {
      Console.WriteLine("ready"); Console.Out.Flush();
    };
    ThreadPool.QueueUserWorkItem(delegate {
      Console.ReadLine();
      visible.BeginInvoke((Action)delegate { hidden.Dispose(); visible.Close(); });
    });
    System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer { Interval = 30000 };
    timer.Tick += delegate { hidden.Dispose(); visible.Close(); };
    timer.Start();
    Application.Run(visible);
  }
}
