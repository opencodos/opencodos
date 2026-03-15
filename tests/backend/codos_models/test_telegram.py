from backend.codos_models.telegram import AuthStatus, TelegramAuthState


class TestAuthStatus:
    def test_values(self):
        assert AuthStatus.NOT_STARTED == "not_started"
        assert AuthStatus.AUTHENTICATED == "authenticated"
        assert AuthStatus.NEEDS_2FA == "needs_2fa"


class TestTelegramAuthState:
    def test_defaults(self):
        state = TelegramAuthState()
        assert state.status == AuthStatus.NOT_STARTED
        assert state.username is None
        assert state.user_id is None
        assert state.qr_image is None
        assert state.message is None

    def test_set_authenticated(self):
        state = TelegramAuthState()
        state.set_authenticated(username="alice", user_id=123)
        assert state.status == AuthStatus.AUTHENTICATED
        assert state.username == "alice"
        assert state.user_id == 123
        assert state.message == "Login successful"

    def test_set_authenticated_no_username(self):
        state = TelegramAuthState()
        state.set_authenticated(username=None, user_id=456)
        assert state.status == AuthStatus.AUTHENTICATED
        assert state.username is None

    def test_reset(self):
        state = TelegramAuthState(
            status=AuthStatus.AUTHENTICATED,
            username="alice",
            user_id=123,
            qr_image="data:image/png;base64,...",
            message="Login successful",
        )
        state.reset()
        assert state.status == AuthStatus.NOT_STARTED
        assert state.username is None
        assert state.user_id is None
        assert state.qr_image is None
        assert state.message is None
