using Microsoft.UI.Xaml;

namespace PlcWiringTrainer.App;

/// <summary>애플리케이션 수명과 단일 주 창을 소유합니다.</summary>
public partial class App : Application
{
    public static MainWindow MainWindow { get; private set; } = null!;

    public App()
    {
        InitializeComponent();
    }

    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        MainWindow = new MainWindow();
        MainWindow.Activate();
    }
}
