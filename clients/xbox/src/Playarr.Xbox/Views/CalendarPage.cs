using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using Playarr.Core.Models;
using Windows.UI;
using Windows.UI.Text;
using Windows.UI.Xaml;
using Windows.UI.Xaml.Controls;
using Windows.UI.Xaml.Media;
using Windows.UI.Xaml.Media.Imaging;
using Windows.UI.Xaml.Navigation;
using CalendarView = Playarr.Core.Models.CalendarView;

namespace Playarr.Xbox.Views
{
    /// <summary>
    /// The web TV calendar (pages/Calendar.tsx) at 1920x1080: agenda (TV default), week and month views over
    /// <c>GET /api/v1/calendar?group=series_day</c>, with the range button (view picker), Previous, Today and Next at the
    /// top right. Status colours and pills follow lib/calendar.ts. Built in code like the other card screens.
    /// </summary>
    public sealed class CalendarPage : Page
    {
        private static readonly CultureInfo Uk = CultureInfo.GetCultureInfo("en-GB");
        private static readonly Color Available = Color.FromArgb(0xFF, 0x8A, 0xC5, 0xA5); // dark --success
        private static readonly Color Absent = Color.FromArgb(0xFF, 0xCF, 0x31, 0x57);    // --brand

        private readonly Grid _root = new Grid();
        private readonly Grid _content = new Grid();
        private Button _rangeButton = null!;
        private CalendarView _view = CalendarView.Agenda;
        private DateTime _anchor = DateTime.Today;
        private IList<CalendarEntry> _entries = new List<CalendarEntry>();
        private int _loadVersion;

        public CalendarPage()
        {
            try
            {
                Build();
            }
            catch (Exception error)
            {
                App.LogCrash(error);
                throw;
            }
        }

        private void Build()
        {
            Background = (Brush)Application.Current.Resources["PlayarrBg"];
            Content = _root;
            _root.Children.Add(_content);
            _root.Children.Add(Ui.BackButton(() => App.Navigation.GoBack()));
            _root.Children.Add(new TextBlock
            {
                Text = "Calendar",
                Style = (Style)Application.Current.Resources["PlayarrPageTitle"],
                Margin = new Thickness(228, 57, 0, 0),
                HorizontalAlignment = HorizontalAlignment.Left,
                VerticalAlignment = VerticalAlignment.Top,
            });

            var controls = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                Spacing = 10,
                HorizontalAlignment = HorizontalAlignment.Right,
                VerticalAlignment = VerticalAlignment.Top,
                Margin = new Thickness(0, 51, 80, 0),
            };
            _rangeButton = Ui.Pill(string.Empty, null);
            var picker = new MenuFlyout();
            foreach (var (label, view) in new[] { ("Agenda", CalendarView.Agenda), ("Week", CalendarView.Week), ("Month", CalendarView.Month) })
            {
                var item = new MenuFlyoutItem { Text = label };
                item.Click += (s, e) => { _view = view; _anchor = DateTime.Today; Load(); };
                picker.Items.Add(item);
            }

            _rangeButton.Flyout = picker;
            controls.Children.Add(_rangeButton);
            controls.Children.Add(Ui.RoundButton("", () => { _anchor = CalendarRules.Step(_view, _anchor, -1); Load(); }));
            controls.Children.Add(Ui.Pill("Today", () => { _anchor = DateTime.Today; Load(); }, 90));
            controls.Children.Add(Ui.RoundButton("", () => { _anchor = CalendarRules.Step(_view, _anchor, 1); Load(); }));
            _root.Children.Add(controls);
        }

        protected override void OnNavigatedTo(NavigationEventArgs e)
        {
            base.OnNavigatedTo(e);
            if (e.Parameter is CalendarView view)
            {
                _view = view;
            }

            Load();
        }

        private async void Load()
        {
            var version = ++_loadVersion;
            var (start, end) = CalendarRules.VisibleRange(_view, _anchor);
            try
            {
                Ui.SetPillText(_rangeButton, RangeLabel(start, end));
                Render();
            }
            catch (Exception error)
            {
                App.LogCrash(error);
                throw;
            }

            try
            {
                // Entries are bucketed by local day, which can differ from the UTC day: pad the window by a day.
                var response = await App.Environment.ApiClient.GetCalendarAsync(start.AddDays(-1), end.AddDays(1));
                if (version != _loadVersion)
                {
                    return;
                }

                _entries = response.Entries;
            }
            catch (Exception)
            {
                if (version != _loadVersion)
                {
                    return;
                }

                // Source health is admin-only; viewers see an empty calendar rather than an error banner (owner rule).
                _entries = new List<CalendarEntry>();
            }

            try
            {
                Render();
            }
            catch (Exception error)
            {
                App.LogCrash(error);
                throw;
            }
        }

        private string RangeLabel(DateTime start, DateTime end) => _view == CalendarView.Month
            ? _anchor.ToString("MMM yyyy", Uk)
            : $"{start.Day} – {end.ToString(start.Month == end.Month ? "d MMM" : "d MMM", Uk)}";

        private void Render()
        {
            _content.Children.Clear();
            var (start, end) = CalendarRules.VisibleRange(_view, _anchor);
            var byDay = _entries
                .GroupBy(CalendarRules.LocalDay)
                .ToDictionary(g => g.Key, g => g.ToList());
            switch (_view)
            {
                case CalendarView.Month:
                    _content.Children.Add(Month(start, end, byDay));
                    break;
                case CalendarView.Week:
                    _content.Children.Add(Week(start, byDay));
                    break;
                default:
                    _content.Children.Add(Agenda(start, end, byDay));
                    break;
            }
        }

        // ---- month -------------------------------------------------------------------------------------------------

        private UIElement Month(DateTime start, DateTime end, Dictionary<DateTime, List<CalendarEntry>> byDay)
        {
            const double left = 154, top = 205, width = 1662, rowHeight = 150;
            var colWidth = width / 7;
            var weeks = (int)((end - start).TotalDays + 1) / 7;
            var canvas = new Canvas();
            for (var c = 0; c < 7; c++)
            {
                var name = start.AddDays(c).ToString("ddd", Uk).ToUpperInvariant();
                var header = Ui.Text(name, 10, FontWeights.SemiBold, "PlayarrInkSoft");
                header.CharacterSpacing = 80;
                header.Width = colWidth;
                header.TextAlignment = TextAlignment.Center;
                Canvas.SetLeft(header, left + c * colWidth);
                Canvas.SetTop(header, 181);
                canvas.Children.Add(header);
            }

            for (var w = 0; w < weeks; w++)
            {
                for (var c = 0; c < 7; c++)
                {
                    var day = start.AddDays(w * 7 + c);
                    byDay.TryGetValue(day, out var entries);
                    var cell = MonthCell(day, entries ?? new List<CalendarEntry>(), colWidth, rowHeight);
                    Canvas.SetLeft(cell, left + c * colWidth);
                    Canvas.SetTop(cell, top + w * rowHeight);
                    canvas.Children.Add(cell);
                }
            }

            return canvas;
        }

        private FrameworkElement MonthCell(DateTime day, List<CalendarEntry> entries, double width, double height)
        {
            var isToday = day == DateTime.Today;
            var cell = new Grid
            {
                Width = width,
                Height = height,
                BorderBrush = isToday ? new SolidColorBrush(Colors.White) : (Brush)Application.Current.Resources["PlayarrLine"],
                BorderThickness = new Thickness(isToday ? 2 : 0.5),
                Background = day.Month == _anchor.Month ? null : new SolidColorBrush(Color.FromArgb(0x30, 0, 0, 0)),
                Padding = new Thickness(10, 8, 10, 8),
            };
            var lines = new StackPanel { Spacing = 7 };
            foreach (var entry in entries.Take(4))
            {
                var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6 };
                row.Children.Add(new Border
                {
                    Width = 6,
                    Height = 6,
                    CornerRadius = new CornerRadius(3),
                    Background = new SolidColorBrush(entry.HasFile ? Available : Absent),
                    VerticalAlignment = VerticalAlignment.Center,
                });
                var grouped = entry.Members != null && entry.Members.Count > 1;
                var text = Ui.Text(grouped ? $"{entry.Title} · {entry.Members!.Count}×" : entry.Title, 10.5, grouped ? FontWeights.Bold : FontWeights.Normal, "PlayarrInk");
                text.MaxWidth = width - 36;
                text.TextTrimming = TextTrimming.CharacterEllipsis;
                row.Children.Add(text);
                lines.Children.Add(row);
            }

            cell.Children.Add(lines);
            var footer = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12, VerticalAlignment = VerticalAlignment.Bottom };
            footer.Children.Add(Ui.Text(day.Day.ToString(CultureInfo.InvariantCulture), 10, FontWeights.SemiBold, "PlayarrInk"));
            if (entries.Count > 4)
            {
                footer.Children.Add(Ui.Text($"+{entries.Count - 4} more", 9, FontWeights.SemiBold, "PlayarrInkSoft"));
            }

            cell.Children.Add(footer);
            return cell;
        }

        // ---- week --------------------------------------------------------------------------------------------------

        private UIElement Week(DateTime start, Dictionary<DateTime, List<CalendarEntry>> byDay)
        {
            var columns = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10, Margin = new Thickness(154, 176, 48, 0) };
            for (var d = 0; d < 7; d++)
            {
                var day = start.AddDays(d);
                var column = new StackPanel { Width = 450, Spacing = 10 };
                column.Children.Add(Ui.Text(day.ToString("dddd d MMMM", Uk), 13, FontWeights.SemiBold, "PlayarrInk"));
                if (byDay.TryGetValue(day, out var entries))
                {
                    foreach (var entry in entries)
                    {
                        column.Children.Add(EntryCard(entry, 450, null));
                    }
                }

                columns.Children.Add(column);
            }

            return new ScrollViewer
            {
                Content = columns,
                HorizontalScrollMode = ScrollMode.Enabled,
                HorizontalScrollBarVisibility = ScrollBarVisibility.Hidden,
                VerticalScrollBarVisibility = ScrollBarVisibility.Hidden,
            };
        }

        // ---- agenda ------------------------------------------------------------------------------------------------

        private UIElement Agenda(DateTime start, DateTime end, Dictionary<DateTime, List<CalendarEntry>> byDay)
        {
            var root = new Grid();
            var detail = new StackPanel { Width = 380, Margin = new Thickness(154, 425, 0, 0), HorizontalAlignment = HorizontalAlignment.Left, VerticalAlignment = VerticalAlignment.Top };
            root.Children.Add(detail);

            var list = new StackPanel { Width = 1033, Margin = new Thickness(783, 168, 0, 48), Spacing = 10 };
            CalendarEntry? first = null;
            for (var day = start; day <= end; day = day.AddDays(1))
            {
                if (!byDay.TryGetValue(day, out var entries))
                {
                    continue;
                }

                var heading = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10, Margin = new Thickness(0, list.Children.Count == 0 ? 0 : 22, 0, 6) };
                heading.Children.Add(Ui.Text(day.ToString("dddd d MMMM", Uk), 14, FontWeights.SemiBold, "PlayarrInk"));
                if (day == DateTime.Today)
                {
                    heading.Children.Add(Ui.StatusPill("TODAY", Colors.White));
                }

                list.Children.Add(heading);
                foreach (var entry in entries)
                {
                    first ??= entry;
                    list.Children.Add(EntryCard(entry, 1033, () => ShowAgendaDetail(detail, entry)));
                }
            }

            if (first != null)
            {
                ShowAgendaDetail(detail, first);
            }

            root.Children.Add(new ScrollViewer { Content = list, VerticalScrollBarVisibility = ScrollBarVisibility.Hidden });
            return root;
        }

        /// <summary>The agenda's left panel follows focus (owner rule: no SELECT needed).</summary>
        private void ShowAgendaDetail(StackPanel detail, CalendarEntry entry)
        {
            detail.Children.Clear();
            var eyebrow = Ui.Text($"{KindLabel(entry).ToUpperInvariant()} · {ReleaseLabel(entry).ToUpperInvariant()}", 10, FontWeights.Bold, "PlayarrBrandInk");
            eyebrow.CharacterSpacing = 120;
            detail.Children.Add(eyebrow);
            var title = Ui.Text(entry.Title, 56, FontWeights.SemiBold, "PlayarrInk");
            title.TextWrapping = TextWrapping.WrapWholeWords;
            title.LineHeight = 58;
            title.CharacterSpacing = -30;
            title.MaxLines = 3;
            title.Margin = new Thickness(0, 22, 0, 0);
            detail.Children.Add(title);
            var when = CalendarRules.LocalDay(entry).ToString("dddd, d MMMM yyyy", Uk) + (TimeLabel(entry) is var t && t != "All day" ? " at " + t : string.Empty);
            detail.Children.Add(Ui.Text(Join(Code(entry), when), 10.5, FontWeights.SemiBold, "PlayarrInkSoft", new Thickness(0, 20, 0, 10)));
            detail.Children.Add(TonePill(entry));
            if (!string.IsNullOrEmpty(entry.Overview))
            {
                var overview = Ui.Text(entry.Overview!, 12.5, FontWeights.Normal, "PlayarrInkSoft", new Thickness(0, 20, 0, 0));
                overview.TextWrapping = TextWrapping.WrapWholeWords;
                overview.LineHeight = 20.5;
                overview.MaxLines = 6;
                overview.TextTrimming = TextTrimming.WordEllipsis;
                detail.Children.Add(overview);
            }

            if (entry.WorkId is { } workId)
            {
                var open = Ui.Pill(entry.MediaKind == "movie" ? "Open movie" : "Open series", () => App.Navigation.Navigate(typeof(WorkDetailPage), workId), 150);
                open.Margin = new Thickness(0, 26, 0, 0);
                detail.Children.Add(open);
            }
        }

        // ---- shared entry card -------------------------------------------------------------------------------------

        private FrameworkElement EntryCard(CalendarEntry entry, double width, Action? onFocus)
        {
            var card = new Button
            {
                Width = width,
                Height = 100,
                Padding = new Thickness(16, 10, 16, 10),
                HorizontalContentAlignment = HorizontalAlignment.Stretch,
                VerticalContentAlignment = VerticalAlignment.Center,
                CornerRadius = new CornerRadius(10),
                Background = (Brush)Application.Current.Resources["PlayarrSurfaceStrong"],
                BorderBrush = (Brush)Application.Current.Resources["PlayarrLine"],
                BorderThickness = new Thickness(1),
                FocusVisualPrimaryBrush = new SolidColorBrush(Colors.White),
                FocusVisualPrimaryThickness = new Thickness(2),
                FocusVisualSecondaryThickness = new Thickness(0),
            };
            if (entry.WorkId is { } workId)
            {
                card.Click += (s, e) => App.Navigation.Navigate(typeof(WorkDetailPage), workId);
            }

            if (onFocus != null)
            {
                card.GotFocus += (s, e) => onFocus();
            }

            var row = new Grid { ColumnSpacing = 14 };
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            // Availability is the entry's left accent (owner rule: have it versus not, never the library).
            var poster = new Border { Width = 34, Height = 52, CornerRadius = new CornerRadius(3), Background = (Brush)Application.Current.Resources["PlayarrSurfaceSoft"] };
            if (Uri.TryCreate(entry.PosterUrl, UriKind.Absolute, out var posterUri))
            {
                poster.Child = new Image { Source = new BitmapImage(posterUri) { DecodePixelWidth = 68 }, Stretch = Stretch.UniformToFill };
            }

            row.Children.Add(poster);
            var text = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Center };
            text.Children.Add(Ui.Text(entry.Title, 15, FontWeights.SemiBold, "PlayarrInk"));
            var line2 = Ui.Text(Join(Code(entry), entry.Subtitle ?? string.Empty), 14, FontWeights.Normal, "PlayarrInkSoft");
            line2.TextTrimming = TextTrimming.CharacterEllipsis;
            text.Children.Add(line2);
            var meta = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10, Margin = new Thickness(0, 3, 0, 0) };
            foreach (var part in new[] { TimeLabel(entry), ReleaseLabel(entry), KindLabel(entry) })
            {
                meta.Children.Add(Ui.Text(part, 9, FontWeights.SemiBold, "PlayarrInkSoft"));
            }

            meta.Children.Add(TonePill(entry));
            text.Children.Add(meta);
            Grid.SetColumn(text, 1);
            row.Children.Add(text);
            card.Content = row;

            var accent = new Grid();
            accent.Children.Add(card);
            accent.Children.Add(new Border
            {
                Width = 3,
                Margin = new Thickness(0, 12, 0, 12),
                HorizontalAlignment = HorizontalAlignment.Left,
                CornerRadius = new CornerRadius(2),
                Background = new SolidColorBrush(entry.HasFile ? Available : Absent),
                IsHitTestVisible = false,
            });
            return accent;
        }

        private static FrameworkElement TonePill(CalendarEntry entry) => CalendarRules.Tone(entry, DateTime.Today) switch
        {
            CalendarTone.Available => Ui.StatusPill("Available", Available),
            CalendarTone.Upcoming => Ui.StatusPill("Upcoming", Color.FromArgb(0xFF, 0xEA, 0xA6, 0xB6)),
            CalendarTone.Missing => Ui.StatusPill("Missing", Color.FromArgb(0xFF, 0xEA, 0xA6, 0xB6)),
            _ => Ui.StatusPill("Not tracked", Color.FromArgb(0xFF, 0xC2, 0xB5, 0xBB)),
        };

        private static string Code(CalendarEntry entry)
        {
            if (entry.Members != null && entry.Members.Count > 1)
            {
                return $"{entry.Members.Count} episodes · " + string.Join(", ", entry.Members.Select(m => CalendarRules.EpisodeCode(m.SeasonNumber, m.EpisodeNumber)));
            }

            return CalendarRules.EpisodeCode(entry.SeasonNumber, entry.EpisodeNumber);
        }

        private static string Join(string a, string b) =>
            string.IsNullOrEmpty(a) ? b : string.IsNullOrEmpty(b) ? a : $"{a} · {b}";

        private static string TimeLabel(CalendarEntry entry) =>
            !string.IsNullOrEmpty(entry.ReleaseAt)
            && DateTimeOffset.TryParse(entry.ReleaseAt, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var at)
                ? at.ToLocalTime().ToString("HH:mm", CultureInfo.InvariantCulture)
                : "All day";

        private static string ReleaseLabel(CalendarEntry entry) => entry.ReleaseType switch
        {
            "air" => "Airs",
            "cinema" => "In cinemas",
            "digital" => "Digital release",
            "physical" => "Physical release",
            _ => "Release",
        };

        private static string KindLabel(CalendarEntry entry) => entry.MediaKind == "movie" ? "Movies" : "Episodes";
    }
}
