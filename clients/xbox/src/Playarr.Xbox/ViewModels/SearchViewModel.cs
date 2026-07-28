using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Playarr.Core.Models;
using Playarr.Core.Networking;
using Playarr.Xbox;

namespace Playarr.Xbox.ViewModels
{
    /// <summary>
    /// Backs <see cref="Views.SearchPage"/>. Follows
    /// <see cref="LoginViewModel"/>'s exact shape: a private
    /// <see cref="XboxAppEnvironment"/> reference reached via the page's
    /// constructor (<c>App.Environment</c>), plain <c>SetProperty</c>-backed
    /// properties, and a fire-and-forget public method
    /// (<see cref="Search"/>) the page never awaits -- it only observes
    /// <see cref="ObservableObject.PropertyChanged"/> and re-renders.
    /// </summary>
    /// <remarks>
    /// <strong>Explicit search, not debounced-as-you-type.</strong> A
    /// debounced live search needs its own timer/cancellation dance on top
    /// of the per-request cancellation this screen already does; for a
    /// catalog search box that is more moving parts than this screen's
    /// value justifies today. <see cref="Search"/> runs once per explicit
    /// invocation -- the page wires it to both the Search button's
    /// <c>Click</c> and the query <c>TextBox</c>'s Enter key -- and its own
    /// in-flight request is still cancelled if a newer one starts before it
    /// finishes, so rapid re-submission behaves the same way debouncing
    /// would; only the "wait a beat after the last keystroke" part is
    /// absent.
    /// <para>
    /// <see cref="RunSearchAsync"/> deliberately omits
    /// <c>.ConfigureAwait(false)</c>, unlike <c>XboxAppEnvironment</c>'s
    /// async methods (see <c>ProfilesViewModel</c>'s identical remark):
    /// this ViewModel's own continuation sets <see cref="Results"/>, which
    /// <see cref="Views.SearchPage"/>'s <c>Render()</c> pushes straight
    /// onto XAML elements -- so it must resume on the UI thread (the
    /// default once the awaited call's continuation isn't opted out of the
    /// UWP-installed <c>SynchronizationContext</c>), not on whatever
    /// thread-pool thread the HTTP call happened to complete on.
    /// </para>
    /// </remarks>
    public sealed class SearchViewModel : ViewModelBase
    {
        private const int ResultLimit = 50;

        private readonly XboxAppEnvironment _environment;
        private CancellationTokenSource? _searchCancellation;

        private string _query = string.Empty;
        private IList<Work> _results = Array.Empty<Work>();
        private bool _isSearching;
        private string? _errorMessage;

        public SearchViewModel(XboxAppEnvironment environment)
        {
            _environment = environment ?? throw new ArgumentNullException(nameof(environment));
        }

        public string Query
        {
            get => _query;
            set => SetProperty(ref _query, value);
        }

        public IList<Work> Results
        {
            get => _results;
            private set => SetProperty(ref _results, value);
        }

        public bool IsSearching
        {
            get => _isSearching;
            private set => SetProperty(ref _isSearching, value);
        }

        /// <summary>Set after a failed <see cref="Search"/> call; <c>null</c> otherwise.</summary>
        public string? ErrorMessage
        {
            get => _errorMessage;
            private set => SetProperty(ref _errorMessage, value);
        }

        /// <summary>
        /// Runs <see cref="IPlayarrApiClient.SearchCatalogAsync"/> for the
        /// current <see cref="Query"/>, cancelling any search already in
        /// flight first. An empty (post-trim) query just clears
        /// <see cref="Results"/> without a network call.
        /// </summary>
        public void Search()
        {
            _searchCancellation?.Cancel();

            var query = Query.Trim();
            if (query.Length == 0)
            {
                _searchCancellation = null;
                IsSearching = false;
                ErrorMessage = null;
                Results = Array.Empty<Work>();
                return;
            }

            var cancellation = new CancellationTokenSource();
            _searchCancellation = cancellation;
            _ = RunSearchAsync(query, cancellation);
        }

        private async Task RunSearchAsync(string query, CancellationTokenSource cancellation)
        {
            IsSearching = true;
            ErrorMessage = null;

            try
            {
                var results = await _environment.ApiClient
                    .SearchCatalogAsync(query, ResultLimit, cancellation.Token);

                if (cancellation.IsCancellationRequested)
                {
                    return;
                }

                Results = new List<Work>(results);
            }
            catch (OperationCanceledException)
            {
                // Superseded by a newer Search() call -- nothing to surface.
            }
            catch (ApiException error)
            {
                if (!cancellation.IsCancellationRequested)
                {
                    ErrorMessage = error.DisplayMessage;
                    Results = Array.Empty<Work>();
                }
            }
            catch (Exception error)
            {
                if (!cancellation.IsCancellationRequested)
                {
                    ErrorMessage = error.Message;
                    Results = Array.Empty<Work>();
                }
            }
            finally
            {
                if (!cancellation.IsCancellationRequested)
                {
                    IsSearching = false;
                }
            }
        }
    }
}
