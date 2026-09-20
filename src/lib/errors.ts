/** Servis katmanı hataları. Action'lar bunları kullanıcıya uygun mesaja çevirir. */

export class AppError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Kayıt yok veya bu tenant'a ait değil. Varlık bilgisini sızdırmamak için ikisi ayırt edilmez. */
export class NotFoundError extends AppError {
  constructor(message = "Kayıt bulunamadı.") {
    super(message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Bu işlem için yetkiniz yok.") {
    super(message);
  }
}

export type FieldErrors = Record<string, string[] | undefined>;

export class ValidationError extends AppError {
  constructor(
    public fieldErrors: FieldErrors,
    message = "Lütfen işaretli alanları kontrol edin.",
  ) {
    super(message);
  }
}

/** İş kuralı çakışması (mükerrer kayıt, kapasite vb.). `detail` arayüzün sunacağı seçenekleri taşır. */
export class ConflictError<D = unknown> extends AppError {
  constructor(
    message: string,
    public code: string,
    public detail?: D,
  ) {
    super(message);
  }
}
