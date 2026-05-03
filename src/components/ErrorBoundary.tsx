import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
  label?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    hasError: false,
    errorMessage: ""
  };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    const message = error instanceof Error ? error.message : "Unknown error";
    return {
      hasError: true,
      errorMessage: message
    };
  }

  componentDidCatch(error: unknown, errorInfo: ErrorInfo): void {
    const context = this.props.label ? ` (${this.props.label})` : "";
    console.error(`Error boundary caught runtime error${context}.`, error, errorInfo);
  }

  private handleRetry = () => {
    this.setState({
      hasError: false,
      errorMessage: ""
    });
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="empty-state" role="alert">
        <p>This panel hit a runtime error and was stopped to prevent a full-page crash.</p>
        <p>{this.state.errorMessage || "No error message was provided."}</p>
        <button type="button" className="mini-action" onClick={this.handleRetry}>
          Retry Panel
        </button>
      </div>
    );
  }
}

